use super::{ServiceError, ServiceResult};
use serde::Serialize;
use std::{
    env,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainInfo {
    pub name: String,
    pub installed: bool,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairAction {
    pub id: String,
    pub label: String,
    pub description: String,
    pub command: Vec<String>,
    pub can_run: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainStatus {
    pub state: String,
    pub elan_path: Option<String>,
    pub elan_version: Option<String>,
    pub required_toolchain: Option<String>,
    pub active_toolchain: Option<String>,
    pub installed_toolchains: Vec<ToolchainInfo>,
    pub repairs: Vec<RepairAction>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub stage: String,
    pub message: String,
    pub running: bool,
    pub succeeded: Option<bool>,
}

impl Default for InstallProgress {
    fn default() -> Self {
        Self {
            stage: "idle".to_owned(),
            message: "No toolchain installation is running.".to_owned(),
            running: false,
            succeeded: None,
        }
    }
}

#[derive(Default)]
pub struct ToolchainManager {
    child: Arc<Mutex<Option<Child>>>,
    progress: Arc<Mutex<InstallProgress>>,
}

impl ToolchainManager {
    pub fn start_install(&self, toolchain: &str) -> ServiceResult<()> {
        validate_toolchain_name(toolchain)?;
        let elan = find_elan().ok_or_else(missing_elan_error)?;
        let mut child_guard = self.child.lock().map_err(lock_error)?;

        if child_guard.is_some() {
            return Err(ServiceError::new(
                "operation-in-progress",
                "A toolchain installation is already running.",
                "Wait for it to finish or cancel it before starting another.",
                None,
            ));
        }

        let mut child = Command::new(&elan)
            .args(["toolchain", "install", toolchain])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| ServiceError::io("start Elan", &elan, &error))?;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        *child_guard = Some(child);
        drop(child_guard);

        update_progress(
            &self.progress,
            InstallProgress {
                stage: "installing".to_owned(),
                message: format!("Installing {toolchain}…"),
                running: true,
                succeeded: None,
            },
        )?;

        if let Some(stdout) = stdout {
            stream_output(stdout, Arc::clone(&self.progress));
        }
        if let Some(stderr) = stderr {
            stream_output(stderr, Arc::clone(&self.progress));
        }

        let child = Arc::clone(&self.child);
        let progress = Arc::clone(&self.progress);
        let toolchain = toolchain.to_owned();
        thread::spawn(move || loop {
            let process_state = {
                let mut guard = match child.lock() {
                    Ok(guard) => guard,
                    Err(_) => return,
                };
                match guard.as_mut() {
                    Some(process) => match process.try_wait() {
                        Ok(Some(status)) => {
                            *guard = None;
                            Some(status.success())
                        }
                        Ok(None) => None,
                        Err(_) => Some(false),
                    },
                    None => {
                        return;
                    }
                }
            };

            if let Some(succeeded) = process_state {
                let _ = update_progress(
                    &progress,
                    InstallProgress {
                        stage: if succeeded { "complete" } else { "failed" }.to_owned(),
                        message: if succeeded {
                            format!("Installed {toolchain}.")
                        } else {
                            format!("Elan could not install {toolchain}.")
                        },
                        running: false,
                        succeeded: Some(succeeded),
                    },
                );
                return;
            }

            thread::sleep(Duration::from_millis(150));
        });

        Ok(())
    }

    pub fn progress(&self) -> ServiceResult<InstallProgress> {
        self.progress
            .lock()
            .map(|progress| progress.clone())
            .map_err(lock_error)
    }

    pub fn cancel(&self) -> ServiceResult<()> {
        let mut child = self.child.lock().map_err(lock_error)?;
        let Some(process) = child.as_mut() else {
            return Ok(());
        };

        process.kill().map_err(|error| {
            ServiceError::new(
                "process",
                "Could not cancel the toolchain installation.",
                "Wait for Elan to finish and try again.",
                Some(error.to_string()),
            )
        })?;
        *child = None;
        update_progress(
            &self.progress,
            InstallProgress {
                stage: "cancelled".to_owned(),
                message: "Toolchain installation cancelled.".to_owned(),
                running: false,
                succeeded: Some(false),
            },
        )
    }
}

pub fn inspect(required_toolchain: Option<&str>) -> ServiceResult<ToolchainStatus> {
    let Some(elan) = find_elan() else {
        return Ok(ToolchainStatus {
            state: "missing-elan".to_owned(),
            elan_path: None,
            elan_version: None,
            required_toolchain: required_toolchain.map(str::to_owned),
            active_toolchain: None,
            installed_toolchains: Vec::new(),
            repairs: vec![RepairAction {
                id: "install-elan".to_owned(),
                label: "Install Elan".to_owned(),
                description: "Install Lean's official toolchain manager, then reopen LeanLander."
                    .to_owned(),
                command: elan_install_command(),
                can_run: false,
            }],
        });
    };

    let version_output = run_elan(&elan, &["--version"])?;
    let list_output = run_elan(&elan, &["toolchain", "list"])?;
    let show_output = run_elan(&elan, &["show"])?;
    let installed_names = parse_toolchain_list(&list_output);
    let active_toolchain = parse_active_toolchain(&show_output);
    let installed_toolchains = installed_names
        .iter()
        .map(|name| ToolchainInfo {
            name: name.clone(),
            installed: true,
            active: active_toolchain.as_deref() == Some(name.as_str()),
        })
        .collect::<Vec<_>>();
    let required_installed = required_toolchain
        .map(|required| {
            installed_names
                .iter()
                .any(|installed| installed == required)
        })
        .unwrap_or(true);
    let repairs = if let Some(required) = required_toolchain.filter(|_| !required_installed) {
        vec![RepairAction {
            id: "install-toolchain".to_owned(),
            label: "Install toolchain".to_owned(),
            description: format!("Install the project-required toolchain {required}."),
            command: vec![
                path_to_string(&elan)?,
                "toolchain".to_owned(),
                "install".to_owned(),
                required.to_owned(),
            ],
            can_run: true,
        }]
    } else {
        Vec::new()
    };

    Ok(ToolchainStatus {
        state: if required_installed {
            "ready"
        } else {
            "missing-toolchain"
        }
        .to_owned(),
        elan_path: Some(path_to_string(&elan)?),
        elan_version: version_output.split_whitespace().nth(1).map(str::to_owned),
        required_toolchain: required_toolchain.map(str::to_owned),
        active_toolchain,
        installed_toolchains,
        repairs,
    })
}

pub fn find_elan() -> Option<PathBuf> {
    elan_candidates().into_iter().find(|path| path.is_file())
}

pub(crate) fn select_toolchain(required_toolchain: Option<&str>) -> ServiceResult<String> {
    if let Some(toolchain) = required_toolchain {
        validate_toolchain_name(toolchain)?;
        return Ok(toolchain.to_owned());
    }

    inspect(None)?.active_toolchain.ok_or_else(|| {
        ServiceError::new(
            "missing-toolchain",
            "No active Lean toolchain was found.",
            "Select a project with a lean-toolchain file or configure an Elan default.",
            None,
        )
    })
}

fn elan_candidates() -> Vec<PathBuf> {
    let executable = if cfg!(windows) { "elan.exe" } else { "elan" };
    let mut candidates = Vec::new();

    if let Some(elan_home) = env::var_os("ELAN_HOME") {
        candidates.push(PathBuf::from(elan_home).join("bin").join(executable));
    }

    let home = env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" });
    if let Some(home) = home {
        candidates.push(
            PathBuf::from(home)
                .join(".elan")
                .join("bin")
                .join(executable),
        );
    }

    if let Some(path) = env::var_os("PATH") {
        candidates.extend(env::split_paths(&path).map(|directory| directory.join(executable)));
    }

    candidates
}

fn run_elan(elan: &Path, arguments: &[&str]) -> ServiceResult<String> {
    let output = Command::new(elan)
        .args(arguments)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| ServiceError::io("run Elan", elan, &error))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(ServiceError::new(
            "toolchain",
            "Elan returned an error while inspecting toolchains.",
            "Run `elan show` in a terminal for more details.",
            Some(String::from_utf8_lossy(&output.stderr).trim().to_owned()),
        ))
    }
}

fn parse_toolchain_list(output: &str) -> Vec<String> {
    output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| {
            line.split_whitespace()
                .next()
                .unwrap_or_default()
                .to_owned()
        })
        .filter(|line| !line.is_empty())
        .collect()
}

fn parse_active_toolchain(output: &str) -> Option<String> {
    let mut in_active_section = false;

    for line in output.lines().map(str::trim) {
        if line == "active toolchain" {
            in_active_section = true;
            continue;
        }

        if in_active_section && !line.is_empty() && !line.chars().all(|character| character == '-')
        {
            return line.split_whitespace().next().map(str::to_owned);
        }
    }

    None
}

pub(crate) fn validate_toolchain_name(toolchain: &str) -> ServiceResult<()> {
    let valid = !toolchain.is_empty()
        && toolchain.len() <= 200
        && toolchain.chars().all(|character| {
            character.is_ascii_alphanumeric()
                || matches!(character, '/' | ':' | '.' | '_' | '-' | '+')
        });

    if valid {
        Ok(())
    } else {
        Err(ServiceError::new(
            "invalid-toolchain",
            "The requested toolchain name is invalid.",
            "Use the exact value from lean-toolchain.",
            Some(toolchain.to_owned()),
        ))
    }
}

fn stream_output<R>(reader: R, progress: Arc<Mutex<InstallProgress>>)
where
    R: std::io::Read + Send + 'static,
{
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(mut current) = progress.lock() {
                if current.running {
                    current.message = line;
                }
            }
        }
    });
}

fn update_progress(
    progress: &Arc<Mutex<InstallProgress>>,
    value: InstallProgress,
) -> ServiceResult<()> {
    *progress.lock().map_err(lock_error)? = value;
    Ok(())
}

fn lock_error<T>(error: std::sync::PoisonError<T>) -> ServiceError {
    ServiceError::new(
        "internal",
        "Toolchain operation state is unavailable.",
        "Restart LeanLander and try again.",
        Some(error.to_string()),
    )
}

fn missing_elan_error() -> ServiceError {
    ServiceError::new(
        "missing-elan",
        "Elan was not found.",
        "Install Elan, then restart LeanLander.",
        None,
    )
}

fn elan_install_command() -> Vec<String> {
    if cfg!(windows) {
        vec!["https://raw.githubusercontent.com/leanprover/elan/master/elan-init.ps1".to_owned()]
    } else {
        vec!["https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh".to_owned()]
    }
}

fn path_to_string(path: &Path) -> ServiceResult<String> {
    path.to_str().map(str::to_owned).ok_or_else(|| {
        ServiceError::new(
            "unsupported-path",
            "The Elan executable path is not valid Unicode.",
            "Install Elan under a path LeanLander can display.",
            Some(path.display().to_string()),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    #[test]
    fn parses_installed_and_active_toolchains() {
        let installed =
            parse_toolchain_list("leanprover/lean4:v4.19.0 (default)\nleanprover/lean4:v4.20.0\n");
        let active = parse_active_toolchain(
            "installed toolchains\n---\n\nactive toolchain\n----------------\n\nleanprover/lean4:v4.20.0 (resolved from override)\n",
        );

        assert_eq!(
            installed,
            ["leanprover/lean4:v4.19.0", "leanprover/lean4:v4.20.0"]
        );
        assert_eq!(active.as_deref(), Some("leanprover/lean4:v4.20.0"));
    }

    #[test]
    fn validates_toolchain_arguments() {
        assert!(validate_toolchain_name("leanprover/lean4:v4.19.0").is_ok());
        assert!(validate_toolchain_name("stable; rm -rf /").is_err());
        assert!(validate_toolchain_name("").is_err());
    }

    #[test]
    fn reports_idle_progress_and_cancels_without_a_process() {
        let manager = ToolchainManager::default();

        assert_eq!(manager.progress().unwrap().stage, "idle");
        assert!(manager.cancel().is_ok());
    }

    #[test]
    fn default_install_location_precedes_path() {
        let candidates = elan_candidates();
        let home: Option<OsString> =
            env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" });

        if let Some(home) = home {
            assert!(
                candidates[0].starts_with(PathBuf::from(home))
                    || env::var_os("ELAN_HOME").is_some()
            );
        }
    }
}
