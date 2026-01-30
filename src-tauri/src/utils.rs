use std::fs;
use std::path::Path;
use uuid::Uuid;

/// Writes content to a file atomically using a temp file + rename pattern.
/// This prevents corruption if the process crashes mid-write.
pub fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid file name")?;
    let tmp_name = format!("{}.tmp", file_name);
    let tmp_path = path.with_file_name(tmp_name);

    fs::write(&tmp_path, contents)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    if path.exists() {
        fs::remove_file(path).map_err(|e| format!("Failed to replace file: {}", e))?;
    }

    fs::rename(&tmp_path, path)
        .map_err(|e| format!("Failed to finalize file write: {}", e))?;

    Ok(())
}

/// Parses a string as a UUID, returning an error if invalid.
/// Use this to validate app IDs and prevent path traversal attacks.
pub fn parse_uuid(id: &str) -> Result<Uuid, String> {
    Uuid::parse_str(id).map_err(|_| format!("Invalid app id: {}", id))
}
