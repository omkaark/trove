use crate::commands::apps::{get_app_html_path, get_app_internal, get_apps_dir_path, save_app};
use crate::models::{validate_name_prompt, AppMetadata};
use chrono::Utc;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager, Window};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
use tokio::time::{timeout, Duration};

static GENERATION_CANCELLED: AtomicBool = AtomicBool::new(false);
static GENERATION_ACTIVE: AtomicBool = AtomicBool::new(false);
static ACTIVE_CHILD: OnceLock<Mutex<Option<CommandChild>>> = OnceLock::new();
const MAX_HTML_BYTES: usize = 10 * 1024 * 1024;

fn child_store() -> &'static Mutex<Option<CommandChild>> {
    ACTIVE_CHILD.get_or_init(|| Mutex::new(None))
}

fn kill_active_child() {
    if let Ok(mut guard) = child_store().lock() {
        if let Some(child) = guard.take() {
            let _ = child.kill();
        }
    }
}

fn validate_sidecar_executable(path: &PathBuf) -> Result<(), String> {
    let metadata =
        fs::metadata(path).map_err(|e| format!("Failed to inspect sidecar: {}", e))?;
    if !metadata.is_file() {
        return Err("Sidecar path is not a file".to_string());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = metadata.permissions().mode();
        if mode & 0o111 == 0 {
            return Err("Sidecar is not marked executable".to_string());
        }
    }
    Ok(())
}

struct ChildCleanup;

impl Drop for ChildCleanup {
    fn drop(&mut self) {
        if let Ok(mut guard) = child_store().lock() {
            guard.take();
        }
    }
}

struct GenerationGuard;

impl GenerationGuard {
    fn acquire() -> Result<Self, String> {
        GENERATION_ACTIVE
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "Another generation is already running".to_string())?;
        Ok(Self)
    }
}

impl Drop for GenerationGuard {
    fn drop(&mut self) {
        GENERATION_ACTIVE.store(false, Ordering::SeqCst);
    }
}

fn process_sidecar_output_line(
    raw_line: &str,
    html_content: &mut String,
    collecting_html: &mut bool,
    error_occurred: &mut Option<String>,
) -> Result<(), String> {
    let line = raw_line.trim();

    if line.starts_with("PROGRESS:") {
        return Ok(());
    }
    if line == "HTML_START" {
        *collecting_html = true;
        return Ok(());
    }
    if line == "HTML_END" {
        *collecting_html = false;
        return Ok(());
    }
    if let Some(msg) = line.strip_prefix("ERROR:") {
        if error_occurred.is_none() {
            *error_occurred = Some(msg.to_string());
        }
        return Ok(());
    }

    if *collecting_html {
        let extra = if html_content.is_empty() { 0 } else { 1 };
        if html_content.len() + raw_line.len() + extra > MAX_HTML_BYTES {
            return Err("Generated HTML exceeded size limit".to_string());
        }
        if !html_content.is_empty() {
            html_content.push('\n');
        }
        html_content.push_str(raw_line);
    }

    Ok(())
}

fn process_sidecar_stdout_chunk(
    chunk: &[u8],
    stdout_buffer: &mut String,
    html_content: &mut String,
    collecting_html: &mut bool,
    error_occurred: &mut Option<String>,
) -> Result<(), String> {
    let chunk = String::from_utf8_lossy(chunk);
    stdout_buffer.push_str(&chunk);

    while let Some(newline_idx) = stdout_buffer.find('\n') {
        let mut line = stdout_buffer[..newline_idx].to_string();
        if line.ends_with('\r') {
            line.pop();
        }

        process_sidecar_output_line(&line, html_content, collecting_html, error_occurred)?;
        stdout_buffer.drain(..=newline_idx);
    }

    Ok(())
}

#[derive(Clone, serde::Serialize)]
pub struct GenerationComplete {
    pub app: AppMetadata,
}

#[derive(Clone, serde::Serialize)]
pub struct GenerationError {
    pub message: String,
}

async fn run_sidecar(
    app_handle: &AppHandle,
    window: &Window,
    name: &str,
    prompt: &str,
    edit_path: Option<PathBuf>,
) -> Result<String, String> {
    let _generation_guard = GenerationGuard::acquire()?;

    let shell = app_handle.shell();
    let sidecar_path = resolve_sidecar_path(app_handle, "trove-sidecar")?;
    let sidecar = shell
        .sidecar(sidecar_path)
        .map_err(|e| format!("Failed to create sidecar: {}", e))?;

    let mut args: Vec<String> = Vec::new();
    if let Some(path) = edit_path {
        let apps_dir = get_apps_dir_path(app_handle)?;
        args.push("--apps-dir".to_string());
        args.push(apps_dir.to_string_lossy().to_string());
        args.push("--edit".to_string());
        args.push(path.to_string_lossy().to_string());
    }
    args.push(name.to_string());
    args.push(prompt.to_string());

    let (mut rx, child) = sidecar
        .args(args)
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    if let Ok(mut guard) = child_store().lock() {
        *guard = Some(child);
    } else {
        return Err("Failed to track sidecar process".to_string());
    }
    let _child_guard = ChildCleanup;

    let mut html_content = String::new();
    let mut collecting_html = false;
    let mut error_occurred: Option<String> = None;
    let mut stdout_buffer = String::new();

    loop {
        if GENERATION_CANCELLED.load(Ordering::SeqCst) {
            kill_active_child();
            return Err("Generation cancelled".to_string());
        }

        let event = match timeout(Duration::from_millis(200), rx.recv()).await {
            Ok(event) => event,
            Err(_) => continue,
        };

        let Some(event) = event else { break };

        use tauri_plugin_shell::process::CommandEvent;
        match event {
            CommandEvent::Stdout(chunk) => {
                if let Err(err) = process_sidecar_stdout_chunk(
                    &chunk,
                    &mut stdout_buffer,
                    &mut html_content,
                    &mut collecting_html,
                    &mut error_occurred,
                ) {
                    kill_active_child();
                    return Err(err);
                }
            }
            CommandEvent::Stderr(line) => {
                let line = String::from_utf8_lossy(&line);
                eprintln!("Sidecar stderr: {}", line);
            }
            CommandEvent::Error(err) => {
                kill_active_child();
                return Err(format!("Sidecar error: {}", err));
            }
            CommandEvent::Terminated(status) => {
                if let Some(code) = status.code {
                    if code != 0 {
                        if let Some(err) = error_occurred.take() {
                            return Err(err);
                        }
                        return Err(format!("Sidecar exited with code {}", code));
                    }
                }
                break;
            }
            _ => {}
        }
    }

    if !stdout_buffer.is_empty() {
        let trailing = stdout_buffer.trim_end_matches('\r').to_string();
        if let Err(err) = process_sidecar_output_line(
            &trailing,
            &mut html_content,
            &mut collecting_html,
            &mut error_occurred,
        ) {
            return Err(err);
        }
        stdout_buffer.clear();
    }

    if let Some(err) = error_occurred.take() {
        let _ = window.emit("generation-error", GenerationError { message: err.clone() });
        return Err(err);
    }

    let final_html = html_content.trim().to_string();
    if final_html.len() > MAX_HTML_BYTES {
        return Err("Generated HTML exceeded size limit".to_string());
    }
    if final_html.is_empty() {
        return Err("No HTML content generated".to_string());
    }

    Ok(final_html)
}

fn resolve_sidecar_path(app_handle: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe()
        .map_err(|e| format!("Failed to resolve current executable: {}", e))?;
    let exe_dir = exe_path
        .parent()
        .ok_or_else(|| "Current executable has no parent directory".to_string())?;

    let candidate = exe_dir.join(name);
    if candidate.exists() {
        validate_sidecar_executable(&candidate)?;
        return Ok(candidate);
    }

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let candidate = resource_dir.join(name);
        if candidate.exists() {
            validate_sidecar_executable(&candidate)?;
            return Ok(candidate);
        }
    }

    #[cfg(target_os = "macos")]
    {
        let arch = if cfg!(target_arch = "aarch64") {
            "aarch64"
        } else if cfg!(target_arch = "x86_64") {
            "x86_64"
        } else {
            ""
        };

        if !arch.is_empty() {
            if let Ok(cwd) = std::env::current_dir() {
                let candidate = cwd
                    .join("src-tauri")
                    .join("binaries")
                    .join(format!("{name}-{arch}-apple-darwin"));
                if candidate.exists() {
                    validate_sidecar_executable(&candidate)?;
                    return Ok(candidate);
                }
            }
        }
    }

    Err(format!(
        "Sidecar '{}' not found next to executable or in resources",
        name
    ))
}

#[tauri::command]
pub async fn generate_app(
    app_handle: AppHandle,
    window: Window,
    name: String,
    prompt: String,
    emoji: String,
    background_color: String,
) -> Result<AppMetadata, String> {
    GENERATION_CANCELLED.store(false, Ordering::SeqCst);

    let trimmed_name = name.trim().to_string();
    let trimmed_prompt = prompt.trim().to_string();
    validate_name_prompt(&trimmed_name, &trimmed_prompt)?;

    let app = AppMetadata::new(trimmed_name, trimmed_prompt, emoji, background_color);
    let final_html =
        run_sidecar(&app_handle, &window, &app.name, &app.prompt, None).await?;

    save_app(&app_handle, &app, &final_html)?;

    let _ = window.emit(
        "generation-complete",
        GenerationComplete { app: app.clone() },
    );

    Ok(app)
}

#[tauri::command]
pub async fn edit_app(
    app_handle: AppHandle,
    window: Window,
    id: String,
    name: String,
    prompt: String,
    emoji: String,
    background_color: String,
) -> Result<AppMetadata, String> {
    GENERATION_CANCELLED.store(false, Ordering::SeqCst);

    let trimmed_name = name.trim().to_string();
    let trimmed_prompt = prompt.trim().to_string();
    validate_name_prompt(&trimmed_name, &trimmed_prompt)?;

    let mut app = get_app_internal(&app_handle, &id)?;
    app.name = trimmed_name;
    app.prompt = trimmed_prompt;
    app.emoji = emoji;
    app.background_color = background_color;
    app.updated_at = Utc::now();

    let uuid = app.id;
    let existing_html_path = get_app_html_path(&app_handle, uuid)?;
    if !existing_html_path.exists() {
        return Err("App HTML file not found".to_string());
    }
    let final_html =
        run_sidecar(&app_handle, &window, &app.name, &app.prompt, Some(existing_html_path))
            .await?;

    save_app(&app_handle, &app, &final_html)?;

    let _ = window.emit("generation-complete", GenerationComplete { app: app.clone() });

    Ok(app)
}

#[tauri::command]
pub fn cancel_generation(window: Window) -> Result<(), String> {
    GENERATION_CANCELLED.store(true, Ordering::SeqCst);
    if let Ok(mut guard) = child_store().lock() {
        if let Some(child) = guard.take() {
            let _ = child.kill();
        }
    }
    let _ = window.emit(
        "generation-error",
        GenerationError {
            message: "Generation cancelled".to_string(),
        },
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        process_sidecar_output_line, process_sidecar_stdout_chunk, MAX_HTML_BYTES,
    };

    #[test]
    fn parses_html_markers_when_chunk_contains_multiple_lines() {
        let mut stdout_buffer = String::new();
        let mut html_content = String::new();
        let mut collecting_html = false;
        let mut error: Option<String> = None;

        process_sidecar_stdout_chunk(
            b"PROGRESS:Generating...\nHTML_START\n<!DOCTYPE html>\n<html></html>\nHTML_END\n",
            &mut stdout_buffer,
            &mut html_content,
            &mut collecting_html,
            &mut error,
        )
        .expect("chunk should parse");

        assert!(stdout_buffer.is_empty());
        assert_eq!(html_content, "<!DOCTYPE html>\n<html></html>");
        assert!(!collecting_html);
        assert!(error.is_none());
    }

    #[test]
    fn parses_marker_when_split_across_chunks() {
        let mut stdout_buffer = String::new();
        let mut html_content = String::new();
        let mut collecting_html = false;
        let mut error: Option<String> = None;

        process_sidecar_stdout_chunk(
            b"HTML_STA",
            &mut stdout_buffer,
            &mut html_content,
            &mut collecting_html,
            &mut error,
        )
        .expect("first chunk should parse");

        assert_eq!(stdout_buffer, "HTML_STA");

        process_sidecar_stdout_chunk(
            b"RT\n<body>\n",
            &mut stdout_buffer,
            &mut html_content,
            &mut collecting_html,
            &mut error,
        )
        .expect("second chunk should parse");

        assert!(collecting_html);
        assert_eq!(html_content, "<body>");
    }

    #[test]
    fn stores_sidecar_error_line() {
        let mut html_content = String::new();
        let mut collecting_html = false;
        let mut error: Option<String> = None;

        process_sidecar_output_line(
            "ERROR:Claude Code CLI not found",
            &mut html_content,
            &mut collecting_html,
            &mut error,
        )
        .expect("error line should parse");

        assert_eq!(error.as_deref(), Some("Claude Code CLI not found"));
    }

    #[test]
    fn rejects_html_larger_than_limit() {
        let mut html_content = String::new();
        let mut collecting_html = true;
        let mut error: Option<String> = None;
        let oversized = "a".repeat(MAX_HTML_BYTES + 1);

        let err = process_sidecar_output_line(
            &oversized,
            &mut html_content,
            &mut collecting_html,
            &mut error,
        )
        .expect_err("oversized html should fail");

        assert_eq!(err, "Generated HTML exceeded size limit");
    }
}
