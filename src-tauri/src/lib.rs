pub mod services;

#[cfg(feature = "desktop")]
use serde_json::Value;
#[cfg(feature = "desktop")]
use services::{
    project::{self, DiscoveredProject, ProjectFile, RecentProject},
    server::{LanguageFeature, ProofState, ServerManager, ServerStatus},
    toolchain::{self, InstallProgress, ToolchainManager, ToolchainStatus},
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
#[tauri::command]
fn toolchain_status(required_toolchain: Option<String>) -> Result<ToolchainStatus, ServiceError> {
    toolchain::inspect(required_toolchain.as_deref())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn install_toolchain(
    manager: tauri::State<'_, ToolchainManager>,
    toolchain: String,
) -> Result<(), ServiceError> {
    manager.start_install(&toolchain)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn toolchain_install_progress(
    manager: tauri::State<'_, ToolchainManager>,
) -> Result<InstallProgress, ServiceError> {
    manager.progress()
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn cancel_toolchain_install(
    manager: tauri::State<'_, ToolchainManager>,
) -> Result<(), ServiceError> {
    manager.cancel()
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn start_lean_server(
    manager: tauri::State<'_, ServerManager>,
    project_path: String,
    required_toolchain: Option<String>,
) -> Result<ServerStatus, ServiceError> {
    manager.start(
        PathBuf::from(project_path).as_path(),
        required_toolchain.as_deref(),
    )
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn lean_server_status(
    manager: tauri::State<'_, ServerManager>,
    project_path: String,
) -> Result<ServerStatus, ServiceError> {
    manager.status(PathBuf::from(project_path).as_path())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn stop_lean_server(
    manager: tauri::State<'_, ServerManager>,
    project_path: String,
) -> Result<(), ServiceError> {
    manager.stop(PathBuf::from(project_path).as_path())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn sync_lean_document(
    manager: tauri::State<'_, ServerManager>,
    project_path: String,
    relative_path: String,
    content: String,
    version: i64,
) -> Result<i64, ServiceError> {
    manager.sync_document(
        PathBuf::from(project_path).as_path(),
        PathBuf::from(relative_path).as_path(),
        &content,
        version,
    )
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn close_lean_document(
    manager: tauri::State<'_, ServerManager>,
    project_path: String,
    relative_path: String,
) -> Result<(), ServiceError> {
    manager.close_document(
        PathBuf::from(project_path).as_path(),
        PathBuf::from(relative_path).as_path(),
    )
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn lean_diagnostics(
    manager: tauri::State<'_, ServerManager>,
    project_path: String,
    relative_path: String,
) -> Result<Vec<Value>, ServiceError> {
    manager.diagnostics(
        PathBuf::from(project_path).as_path(),
        PathBuf::from(relative_path).as_path(),
    )
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn lean_language_request(
    manager: tauri::State<'_, ServerManager>,
    project_path: String,
    relative_path: String,
    feature: LanguageFeature,
    line: u32,
    character: u32,
) -> Result<Value, ServiceError> {
    manager.request_language_feature(
        PathBuf::from(project_path).as_path(),
        PathBuf::from(relative_path).as_path(),
        feature,
        line,
        character,
    )
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn lean_proof_state(
    manager: tauri::State<'_, ServerManager>,
    project_path: String,
    relative_path: String,
    line: u32,
    character: u32,
) -> Result<ProofState, ServiceError> {
    manager.proof_state(
        PathBuf::from(project_path).as_path(),
        PathBuf::from(relative_path).as_path(),
        line,
        character,
    )
}

#[cfg(feature = "desktop")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ToolchainManager::default())
        .manage(ServerManager::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            discover_project,
            load_project_file,
            save_project_file,
            recent_projects,
            toolchain_status,
            install_toolchain,
            toolchain_install_progress,
            cancel_toolchain_install,
            start_lean_server,
            lean_server_status,
            stop_lean_server,
            sync_lean_document,
            close_lean_document,
            lean_diagnostics,
            lean_language_request,
            lean_proof_state
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
