pub mod services;

#[cfg(feature = "desktop")]
use serde_json::Value;
#[cfg(feature = "desktop")]
use services::{
    doctor::{self, DoctorLogs, DoctorReport},
    lake::{CreateProjectOptions, LakeManager, LakeProgress},
    project::{self, DiscoveredProject, ProjectFile, ProjectSearchResult, RecentProject},
    server::{DocumentChange, LanguageFeature, ProofState, ServerManager, ServerStatus},
    toolchain::{self, InstallProgress, ToolchainManager, ToolchainStatus},
    ServiceError,
};
#[cfg(feature = "desktop")]
use std::path::PathBuf;
#[cfg(feature = "desktop")]
use tauri::{Emitter, Manager};

#[cfg(feature = "desktop")]
/// Runs service work on the blocking pool. Synchronous commands execute on the
/// main thread, where a slow Elan call, filesystem walk, or Lean handshake
/// freezes the whole window.
async fn blocking<T, F>(task: F) -> Result<T, ServiceError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, ServiceError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| {
            ServiceError::new(
                "internal",
                "A background task stopped unexpectedly.",
                "Try again, and restart LeanLander if it keeps happening.",
                Some(error.to_string()),
            )
        })?
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn discover_project(
    app: tauri::AppHandle,
    path: String,
) -> Result<DiscoveredProject, ServiceError> {
    blocking(move || {
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
    })
    .await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn load_project_file(
    project_path: String,
    relative_path: String,
) -> Result<ProjectFile, ServiceError> {
    blocking(move || {
        project::load_project_file(
            PathBuf::from(project_path).as_path(),
            PathBuf::from(relative_path).as_path(),
        )
    })
    .await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn load_project_uri(project_path: String, uri: String) -> Result<ProjectFile, ServiceError> {
    blocking(move || project::load_project_uri(PathBuf::from(project_path).as_path(), &uri)).await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn search_project(
    project_path: String,
    query: String,
) -> Result<Vec<ProjectSearchResult>, ServiceError> {
    blocking(move || project::search_project(PathBuf::from(project_path).as_path(), &query)).await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn save_project_file(
    project_path: String,
    relative_path: String,
    content: String,
) -> Result<(), ServiceError> {
    blocking(move || {
        project::save_project_file(
            PathBuf::from(project_path).as_path(),
            PathBuf::from(relative_path).as_path(),
            &content,
        )
    })
    .await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn recent_projects(app: tauri::AppHandle) -> Result<Vec<RecentProject>, ServiceError> {
    blocking(move || {
        let data_dir = app.path().app_data_dir().map_err(|error| {
            ServiceError::new(
                "configuration",
                "Could not locate the LeanLander application data directory.",
                "Check the operating system account permissions.",
                Some(error.to_string()),
            )
        })?;
        project::load_recent_projects(&data_dir)
    })
    .await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn toolchain_status(
    required_toolchain: Option<String>,
) -> Result<ToolchainStatus, ServiceError> {
    blocking(move || toolchain::inspect(required_toolchain.as_deref())).await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn install_toolchain(app: tauri::AppHandle, toolchain: String) -> Result<(), ServiceError> {
    blocking(move || app.state::<ToolchainManager>().start_install(&toolchain)).await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn toolchain_install_progress(
    app: tauri::AppHandle,
) -> Result<InstallProgress, ServiceError> {
    blocking(move || app.state::<ToolchainManager>().progress()).await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn cancel_toolchain_install(app: tauri::AppHandle) -> Result<(), ServiceError> {
    blocking(move || app.state::<ToolchainManager>().cancel()).await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn start_lean_server(
    app: tauri::AppHandle,
    project_path: String,
    required_toolchain: Option<String>,
) -> Result<ServerStatus, ServiceError> {
    blocking(move || {
        app.state::<ServerManager>().start(
            PathBuf::from(project_path).as_path(),
            required_toolchain.as_deref(),
        )
    })
    .await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn lean_server_status(
    app: tauri::AppHandle,
    project_path: String,
) -> Result<ServerStatus, ServiceError> {
    blocking(move || {
        app.state::<ServerManager>()
            .status(PathBuf::from(project_path).as_path())
    })
    .await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn stop_lean_server(app: tauri::AppHandle, project_path: String) -> Result<(), ServiceError> {
    blocking(move || {
        app.state::<ServerManager>()
            .stop(PathBuf::from(project_path).as_path())
    })
    .await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn sync_lean_document(
    app: tauri::AppHandle,
    project_path: String,
    relative_path: String,
    content: String,
    version: i64,
    changes: Option<Vec<DocumentChange>>,
) -> Result<i64, ServiceError> {
    blocking(move || {
        app.state::<ServerManager>().sync_document(
            PathBuf::from(project_path).as_path(),
            PathBuf::from(relative_path).as_path(),
            &content,
            version,
            changes,
        )
    })
    .await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn close_lean_document(
    app: tauri::AppHandle,
    project_path: String,
    relative_path: String,
) -> Result<(), ServiceError> {
    blocking(move || {
        app.state::<ServerManager>().close_document(
            PathBuf::from(project_path).as_path(),
            PathBuf::from(relative_path).as_path(),
        )
    })
    .await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn lean_diagnostics(
    app: tauri::AppHandle,
    project_path: String,
    relative_path: String,
) -> Result<Vec<Value>, ServiceError> {
    blocking(move || {
        app.state::<ServerManager>().diagnostics(
            PathBuf::from(project_path).as_path(),
            PathBuf::from(relative_path).as_path(),
        )
    })
    .await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn lean_language_request(
    app: tauri::AppHandle,
    project_path: String,
    relative_path: String,
    feature: LanguageFeature,
    line: u32,
    character: u32,
) -> Result<Value, ServiceError> {
    blocking(move || {
        app.state::<ServerManager>().request_language_feature(
            PathBuf::from(project_path).as_path(),
            PathBuf::from(relative_path).as_path(),
            feature,
            line,
            character,
        )
    })
    .await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn lean_proof_state(
    app: tauri::AppHandle,
    project_path: String,
    relative_path: String,
    line: u32,
    character: u32,
) -> Result<ProofState, ServiceError> {
    blocking(move || {
        app.state::<ServerManager>().proof_state(
            PathBuf::from(project_path).as_path(),
            PathBuf::from(relative_path).as_path(),
            line,
            character,
        )
    })
    .await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn lean_infoview_request(
    app: tauri::AppHandle,
    project_path: String,
    relative_path: String,
    method: String,
    params: Value,
) -> Result<Value, ServiceError> {
    blocking(move || {
        app.state::<ServerManager>().infoview_request(
            PathBuf::from(project_path).as_path(),
            PathBuf::from(relative_path).as_path(),
            &method,
            params,
        )
    })
    .await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn lean_infoview_notification(
    app: tauri::AppHandle,
    project_path: String,
    relative_path: String,
    method: String,
    params: Value,
) -> Result<(), ServiceError> {
    blocking(move || {
        app.state::<ServerManager>().infoview_notification(
            PathBuf::from(project_path).as_path(),
            PathBuf::from(relative_path).as_path(),
            &method,
            params,
        )
    })
    .await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn create_lean_rpc_session(
    app: tauri::AppHandle,
    project_path: String,
    relative_path: String,
) -> Result<String, ServiceError> {
    blocking(move || {
        app.state::<ServerManager>().create_rpc_session(
            PathBuf::from(project_path).as_path(),
            PathBuf::from(relative_path).as_path(),
        )
    })
    .await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn close_lean_rpc_session(
    app: tauri::AppHandle,
    project_path: String,
    session_id: String,
) -> Result<(), ServiceError> {
    blocking(move || {
        app.state::<ServerManager>()
            .close_rpc_session(PathBuf::from(project_path).as_path(), &session_id)
    })
    .await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn create_lake_project(
    app: tauri::AppHandle,
    options: CreateProjectOptions,
) -> Result<(), ServiceError> {
    blocking(move || app.state::<LakeManager>().start_create(options)).await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn fetch_lake_dependencies(
    app: tauri::AppHandle,
    project_path: String,
    required_toolchain: Option<String>,
) -> Result<(), ServiceError> {
    blocking(move || {
        app.state::<LakeManager>().start_fetch(
            PathBuf::from(project_path).as_path(),
            required_toolchain.as_deref(),
        )
    })
    .await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn build_lake_project(
    app: tauri::AppHandle,
    project_path: String,
    required_toolchain: Option<String>,
) -> Result<(), ServiceError> {
    blocking(move || {
        app.state::<LakeManager>().start_build(
            PathBuf::from(project_path).as_path(),
            required_toolchain.as_deref(),
        )
    })
    .await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn lake_operation_progress(app: tauri::AppHandle) -> Result<LakeProgress, ServiceError> {
    blocking(move || app.state::<LakeManager>().progress()).await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn cancel_lake_operation(app: tauri::AppHandle) -> Result<(), ServiceError> {
    blocking(move || app.state::<LakeManager>().cancel()).await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn diagnose_environment(
    app: tauri::AppHandle,
    project_path: Option<String>,
    required_toolchain: Option<String>,
) -> Result<DoctorReport, ServiceError> {
    blocking(move || {
        let lake = app.state::<LakeManager>();
        let server = app.state::<ServerManager>();
        let project_path = project_path.map(PathBuf::from);
        doctor::diagnose(
            project_path.as_deref(),
            required_toolchain.as_deref(),
            &lake,
            &server,
        )
    })
    .await
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn doctor_logs(
    app: tauri::AppHandle,
    project_path: Option<String>,
    required_toolchain: Option<String>,
) -> Result<DoctorLogs, ServiceError> {
    blocking(move || {
        let lake = app.state::<LakeManager>();
        let server = app.state::<ServerManager>();
        let project_path = project_path.map(PathBuf::from);
        doctor::diagnostic_logs(
            project_path.as_deref(),
            required_toolchain.as_deref(),
            &lake,
            &server,
        )
    })
    .await
}

#[cfg(feature = "desktop")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ToolchainManager::default())
        .manage(ServerManager::default())
        .manage(LakeManager::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            discover_project,
            load_project_file,
            load_project_uri,
            search_project,
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
            lean_proof_state,
            lean_infoview_request,
            lean_infoview_notification,
            create_lean_rpc_session,
            close_lean_rpc_session,
            create_lake_project,
            fetch_lake_dependencies,
            build_lake_project,
            lake_operation_progress,
            cancel_lake_operation,
            diagnose_environment,
            doctor_logs
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            app.state::<ServerManager>()
                .set_event_sink(std::sync::Arc::new(move |event, payload| {
                    let _ = handle.emit(event, payload);
                }))?;
            let handle = app.handle().clone();
            app.state::<LakeManager>()
                .set_event_sink(std::sync::Arc::new(move |event, payload| {
                    let _ = handle.emit(event, payload);
                }))?;
            let handle = app.handle().clone();
            app.state::<ToolchainManager>()
                .set_event_sink(std::sync::Arc::new(move |event, payload| {
                    let _ = handle.emit(event, payload);
                }))?;
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
