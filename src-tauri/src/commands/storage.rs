use crate::commands::apps::get_apps_dir_path;
use crate::utils::{parse_uuid, write_atomic};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

fn get_storage_path(app_handle: &AppHandle, app_id: &str) -> Result<PathBuf, String> {
    // Validate app_id is a valid UUID to prevent path traversal
    parse_uuid(app_id)?;
    let apps_dir = get_apps_dir_path(app_handle)?;
    Ok(apps_dir.join(format!("{}.data.json", app_id)))
}

fn load_storage(app_handle: &AppHandle, app_id: &str) -> Result<Map<String, Value>, String> {
    let path = get_storage_path(app_handle, app_id)?;
    if !path.exists() {
        return Ok(Map::new());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read storage file: {}", e))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse storage file: {}", e))
}

fn save_storage(
    app_handle: &AppHandle,
    app_id: &str,
    data: &Map<String, Value>,
) -> Result<(), String> {
    let path = get_storage_path(app_handle, app_id)?;

    let content = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize storage: {}", e))?;

    write_atomic(&path, &content)
}

#[tauri::command]
pub fn storage_get(
    app_handle: AppHandle,
    app_id: String,
    key: String,
) -> Result<Option<Value>, String> {
    let storage = load_storage(&app_handle, &app_id)?;
    Ok(storage.get(&key).cloned())
}

#[tauri::command]
pub fn storage_set(
    app_handle: AppHandle,
    app_id: String,
    key: String,
    value: Value,
) -> Result<(), String> {
    let mut storage = load_storage(&app_handle, &app_id)?;
    storage.insert(key, value);
    save_storage(&app_handle, &app_id, &storage)
}

#[tauri::command]
pub fn storage_delete(
    app_handle: AppHandle,
    app_id: String,
    key: String,
) -> Result<(), String> {
    let mut storage = load_storage(&app_handle, &app_id)?;
    storage.remove(&key);
    save_storage(&app_handle, &app_id, &storage)
}

#[tauri::command]
pub fn storage_clear(app_handle: AppHandle, app_id: String) -> Result<(), String> {
    delete_storage_file(&app_handle, &app_id)
}

#[tauri::command]
pub fn storage_get_all(
    app_handle: AppHandle,
    app_id: String,
) -> Result<HashMap<String, Value>, String> {
    let storage = load_storage(&app_handle, &app_id)?;
    Ok(storage.into_iter().collect())
}

pub fn delete_storage_file(app_handle: &AppHandle, app_id: &str) -> Result<(), String> {
    let path = get_storage_path(app_handle, app_id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete storage file: {}", e))?;
    }
    Ok(())
}
