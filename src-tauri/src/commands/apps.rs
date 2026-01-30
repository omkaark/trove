use crate::models::{AppMetadata, AppsIndex};
use crate::utils::{parse_uuid, write_atomic};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

fn migrate_legacy_apps(apps_dir: &Path) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Ok(());
    }

    if apps_dir.exists() {
        if let Ok(mut entries) = fs::read_dir(apps_dir) {
            if entries.next().is_some() {
                return Ok(());
            }
        }
    }

    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let legacy_dir = home
        .join("Library")
        .join("Application Support")
        .join("com.omkaarwork.trove")
        .join("apps");

    if !legacy_dir.exists() {
        return Ok(());
    }

    fs::create_dir_all(apps_dir)
        .map_err(|e| format!("Failed to create apps directory: {}", e))?;

    for entry in fs::read_dir(&legacy_dir)
        .map_err(|e| format!("Failed to read legacy apps: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read legacy entry: {}", e))?;
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name() {
                let dest = apps_dir.join(name);
                if !dest.exists() {
                    fs::copy(&path, &dest)
                        .map_err(|e| format!("Failed to migrate file: {}", e))?;
                }
            }
        }
    }

    Ok(())
}

fn get_apps_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let apps_dir = app_data_dir.join("apps");

    if !apps_dir.exists() {
        fs::create_dir_all(&apps_dir)
            .map_err(|e| format!("Failed to create apps directory: {}", e))?;
    }

    migrate_legacy_apps(&apps_dir)?;

    Ok(apps_dir)
}

pub fn get_apps_dir_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    get_apps_dir(app_handle)
}

fn get_index_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_apps_dir(app_handle)?.join("apps.json"))
}

fn load_index(app_handle: &AppHandle) -> Result<AppsIndex, String> {
    let index_path = get_index_path(app_handle)?;
    if !index_path.exists() {
        return Ok(AppsIndex::default());
    }

    let content = fs::read_to_string(&index_path)
        .map_err(|e| format!("Failed to read apps index: {}", e))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse apps index: {}", e))
}

fn save_index(app_handle: &AppHandle, index: &AppsIndex) -> Result<(), String> {
    let index_path = get_index_path(app_handle)?;
    let content = serde_json::to_string_pretty(index)
        .map_err(|e| format!("Failed to serialize apps index: {}", e))?;

    write_atomic(&index_path, &content)
}

pub fn get_app_html_path(app_handle: &AppHandle, id: Uuid) -> Result<PathBuf, String> {
    Ok(get_apps_dir(app_handle)?.join(format!("{}.html", id)))
}

#[tauri::command]
pub fn list_apps(app_handle: AppHandle) -> Result<Vec<AppMetadata>, String> {
    let index = load_index(&app_handle)?;
    Ok(index.apps)
}

pub(crate) fn get_app_internal(app_handle: &AppHandle, id: &str) -> Result<AppMetadata, String> {
    let uuid = parse_uuid(id)?;
    let index = load_index(app_handle)?;
    index
        .get(uuid)
        .cloned()
        .ok_or_else(|| format!("App not found: {}", id))
}

#[tauri::command]
pub fn get_app_path(app_handle: AppHandle, id: String) -> Result<String, String> {
    let uuid = parse_uuid(&id)?;
    let path = get_app_html_path(&app_handle, uuid)?;
    if !path.exists() {
        return Err(format!("App HTML file not found for id: {}", id));
    }
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn delete_app(app_handle: AppHandle, id: String) -> Result<(), String> {
    let uuid = parse_uuid(&id)?;

    let mut index = load_index(&app_handle)?;
    index
        .remove(uuid)
        .ok_or_else(|| format!("App not found: {}", id))?;
    save_index(&app_handle, &index)?;

    let html_path = get_app_html_path(&app_handle, uuid)?;
    if html_path.exists() {
        fs::remove_file(&html_path)
            .map_err(|e| format!("Failed to delete app HTML: {}", e))?;
    }

    // Delete associated storage file
    crate::commands::storage::delete_storage_file(&app_handle, &id)?;

    Ok(())
}

pub fn save_app(
    app_handle: &AppHandle,
    app: &AppMetadata,
    html_content: &str,
) -> Result<(), String> {
    let mut index = load_index(app_handle)?;

    if let Some(existing) = index.get_mut(app.id) {
        *existing = app.clone();
    } else {
        index.add(app.clone());
    }

    save_index(app_handle, &index)?;

    let html_path = get_app_html_path(app_handle, app.id)?;
    write_atomic(&html_path, html_content)?;

    Ok(())
}

#[tauri::command]
pub fn update_app_metadata(
    app_handle: AppHandle,
    id: String,
    name: String,
    emoji: String,
    background_color: String,
) -> Result<AppMetadata, String> {
    let uuid = parse_uuid(&id)?;
    let mut index = load_index(&app_handle)?;

    let app = index
        .get_mut(uuid)
        .ok_or_else(|| format!("App not found: {}", id))?;

    app.name = name;
    app.emoji = emoji;
    app.background_color = background_color;
    app.updated_at = chrono::Utc::now();

    let updated_app = app.clone();
    save_index(&app_handle, &index)?;

    Ok(updated_app)
}
