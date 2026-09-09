pub mod services;

#[cfg(feature = "desktop")]
use services::{
    project::{self, DiscoveredProject, ProjectFile, RecentProject},
    ServiceError,
};
#[cfg(feature = "desktop")]
use std::path::PathBuf;
#[cfg(feature = "desktop")]
use tauri::Manager;

#[cfg(feature = "desktop")]
#[tauri::command]
fn discover_project(
    app: tauri::AppHandle,
    path: String,
) -> Result<DiscoveredProject, ServiceError> {
    let mut project = project::discover_project(PathBuf::from(path).as_path())?;
    let data_dir = app.path().app_data_dir().map_err(|error| {
        ServiceError::new(
            "configuration",
            "Could not locate the LeanLander application data directory.",
            "Check the operating system account permissions.",
            Some(error.to_string()),
        )
    })?;

    if let Err(error) = project::remember_project(&data_dir, &project.metadata) {
        project.metadata.warnings.push(error.summary);
    }

    Ok(project)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn load_project_file(
    project_path: String,
    relative_path: String,
) -> Result<ProjectFile, ServiceError> {
    project::load_project_file(
        PathBuf::from(project_path).as_path(),
        PathBuf::from(relative_path).as_path(),
    )
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn save_project_file(
    project_path: String,
    relative_path: String,
    content: String,
) -> Result<(), ServiceError> {
    project::save_project_file(
        PathBuf::from(project_path).as_path(),
        PathBuf::from(relative_path).as_path(),
        &content,
    )
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn recent_projects(app: tauri::AppHandle) -> Result<Vec<RecentProject>, ServiceError> {
    let data_dir = app.path().app_data_dir().map_err(|error| {
        ServiceError::new(
            "configuration",
            "Could not locate the LeanLander application data directory.",
            "Check the operating system account permissions.",
            Some(error.to_string()),
        )
    })?;
    project::load_recent_projects(&data_dir)
}

#[cfg(feature = "desktop")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            discover_project,
            load_project_file,
            save_project_file,
            recent_projects
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
