mod commands;
mod models;
mod utils;

use commands::{
    cancel_generation, delete_app, edit_app, generate_app, get_app_path, list_apps,
    storage_clear, storage_delete, storage_get, storage_get_all, storage_set,
    update_app_metadata,
};
use tauri::Manager;

#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                let window = app.get_webview_window("main").unwrap();
                apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, None, None)
                    .expect("Failed to apply vibrancy");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_apps,
            get_app_path,
            delete_app,
            generate_app,
            edit_app,
            cancel_generation,
            update_app_metadata,
            storage_get,
            storage_set,
            storage_delete,
            storage_clear,
            storage_get_all
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|err| {
            eprintln!("error while running tauri application: {err}");
        });
}
