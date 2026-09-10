use super::{
    lake::{dependency_download_command, missing_dependencies, LakeManager, LakeProgress},
    project::canonical_project_root,
    server::{ServerManager, ServerStatus},
    toolchain::{self, ToolchainStatus},
    ServiceResult,
};
use serde::Serialize;
use std::{
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const PROBE_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_PROBE_BYTES: u64 = 16 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DoctorStatus {
    Ok,
    Warning,
    Error,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorRepair {
    pub id: String,
    pub label: String,
    pub description: String,
    pub can_run: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorCheck {
    pub id: String,
    pub label: String,
    pub status: DoctorStatus,
    pub summary: String,
    pub repair: Option<DoctorRepair>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorReport {
    pub status: DoctorStatus,
    pub checks: Vec<DoctorCheck>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorLogSection {
    pub label: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorLogs {
    pub sections: Vec<DoctorLogSection>,
}

#[derive(Debug)]
struct ProbeOutput {
    version: String,
    details: String,
}

pub fn diagnose(
    project_path: Option<&Path>,
    required_toolchain: Option<&str>,
    lake: &LakeManager,
    server: &ServerManager,
) -> ServiceResult<DoctorReport> {
    validate_request(required_toolchain)?;
    let root = project_path.map(canonical_project_root).transpose()?;
    let inspection = toolchain::inspect(required_toolchain);
    let selected = inspection
        .as_ref()
        .ok()
        .filter(|status| status.state == "ready")
        .and_then(selected_toolchain);
    let elan = inspection
        .as_ref()
        .ok()
        .and_then(|status| status.elan_path.as_deref())
        .map(PathBuf::from);
    let lean_probe = probe_selected(elan.as_deref(), selected, "lean");
    let lake_probe = probe_selected(elan.as_deref(), selected, "lake");
    let lake_progress = lake.progress()?;
    let server_status = root.as_deref().map(|path| server.status(path));
    let toolchain_ready = inspection
        .as_ref()
        .is_ok_and(|status| status.state == "ready" && selected_toolchain(status).is_some());

    let checks = vec![
        elan_check(&inspection),
        toolchain_check(&inspection),
        executable_check("lean", "Lean", lean_probe.as_ref(), selected),
        executable_check("lake", "Lake", lake_probe.as_ref(), selected),
        dependency_check(root.as_deref(), &lake_progress, toolchain_ready),
        server_check(server_status.as_ref(), toolchain_ready),
    ];
    let status = overall_status(&checks);

    Ok(DoctorReport { status, checks })
}

pub fn diagnostic_logs(
    project_path: Option<&Path>,
    required_toolchain: Option<&str>,
    lake: &LakeManager,
    server: &ServerManager,
) -> ServiceResult<DoctorLogs> {
    validate_request(required_toolchain)?;
    let root = project_path.map(canonical_project_root).transpose()?;
    let inspection = toolchain::inspect(required_toolchain);
    let mut environment = Vec::new();

    if let Some(root) = root.as_deref() {
        environment.push(format!("Project: {}", root.display()));
    } else {
        environment.push("Project: no local project open".to_owned());
    }

    let selected = match &inspection {
        Ok(status) => {
            environment.push(format!(
                "Elan: {}",
                status
                    .elan_version
                    .as_deref()
                    .unwrap_or("version unavailable")
            ));
            environment.push(format!(
                "Elan executable: {}",
                status.elan_path.as_deref().unwrap_or("not found")
            ));
            environment.push(format!(
                "Required toolchain: {}",
                status
                    .required_toolchain
                    .as_deref()
                    .unwrap_or("not specified")
            ));
            environment.push(format!(
                "Active toolchain: {}",
                status
                    .active_toolchain
                    .as_deref()
                    .unwrap_or("not configured")
            ));
            (status.state == "ready")
                .then(|| selected_toolchain(status).map(str::to_owned))
                .flatten()
        }
        Err(error) => {
            environment.push(format!("Inspection failed: {}", error.summary));
            if let Some(debug) = &error.debug {
                environment.push(debug.clone());
            }
            None
        }
    };

    let elan = inspection
        .as_ref()
        .ok()
        .and_then(|status| status.elan_path.as_deref())
        .map(PathBuf::from);
    if let (Some(elan), Some(toolchain)) = (elan.as_deref(), selected.as_deref()) {
        environment.push(probe_log(elan, toolchain, "lean", "Lean"));
        environment.push(probe_log(elan, toolchain, "lake", "Lake"));
    }

    let lake_progress = lake.progress()?;
    let mut lake_lines = Vec::new();
    if progress_matches(root.as_deref(), &lake_progress) {
        lake_lines.push(format!(
            "Last operation: {} / {} / {}",
            lake_progress.operation, lake_progress.stage, lake_progress.message
        ));
        if let Some(failure) = &lake_progress.failure {
            lake_lines.push(format!("Failure category: {}", failure.category));
            lake_lines.push(format!("Suggested action: {}", failure.suggestion));
            if let Some(details) = &failure.details {
                lake_lines.push(details.clone());
            }
        }
        lake_lines.extend(lake.diagnostic_log()?);
    } else {
        lake_lines.push("No Lake output was captured for this project.".to_owned());
    }

    let mut server_lines = Vec::new();
    if let Some(root) = root.as_deref() {
        match server.status(root) {
            Ok(status) => {
                server_lines.push(format!("State: {}", status.state));
                server_lines.push(format!("Message: {}", status.message));
                if let Some(version) = status.version {
                    server_lines.push(format!("Version: {version}"));
                }
            }
            Err(error) => server_lines.push(format!("Status unavailable: {}", error.summary)),
        }
        match server.diagnostic_log(root) {
            Ok(lines) => server_lines.extend(lines),
            Err(error) => server_lines.push(format!("Logs unavailable: {}", error.summary)),
        }
    } else {
        server_lines.push("No local project is open.".to_owned());
    }

    Ok(DoctorLogs {
        sections: vec![
            DoctorLogSection {
                label: "Environment".to_owned(),
                content: environment.join("\n"),
            },
            DoctorLogSection {
                label: "Lake".to_owned(),
                content: lake_lines.join("\n"),
            },
            DoctorLogSection {
                label: "Lean server".to_owned(),
                content: server_lines.join("\n"),
            },
        ],
    })
}

fn validate_request(required_toolchain: Option<&str>) -> ServiceResult<()> {
    if let Some(toolchain) = required_toolchain {
        toolchain::validate_toolchain_name(toolchain)?;
    }
    Ok(())
}

fn selected_toolchain(status: &ToolchainStatus) -> Option<&str> {
    status
        .required_toolchain
        .as_deref()
        .or(status.active_toolchain.as_deref())
}

fn elan_check(inspection: &ServiceResult<ToolchainStatus>) -> DoctorCheck {
    match inspection {
        Ok(status) if status.state == "missing-elan" => DoctorCheck {
            id: "elan".to_owned(),
            label: "Elan".to_owned(),
            status: DoctorStatus::Error,
            summary: "Elan was not found.".to_owned(),
            repair: status.repairs.first().map(|repair| DoctorRepair {
                id: repair.id.clone(),
                label: repair.label.clone(),
                description: repair.description.clone(),
                can_run: repair.can_run,
            }),
        },
        Ok(status) => DoctorCheck {
            id: "elan".to_owned(),
            label: "Elan".to_owned(),
            status: DoctorStatus::Ok,
            summary: format!(
                "Elan {} is available.",
                status.elan_version.as_deref().unwrap_or("version unknown")
            ),
            repair: None,
        },
        Err(error) => DoctorCheck {
            id: "elan".to_owned(),
            label: "Elan".to_owned(),
            status: DoctorStatus::Error,
            summary: error.summary.clone(),
            repair: Some(manual_repair(
                "inspect-elan",
                "Inspect Elan",
                &error.suggestion,
            )),
        },
    }
}

fn toolchain_check(inspection: &ServiceResult<ToolchainStatus>) -> DoctorCheck {
    match inspection {
        Ok(status) if status.state == "missing-elan" => unavailable_check(
            "toolchain",
            "Toolchain",
            "Install Elan before checking Lean toolchains.",
        ),
        Ok(status) if status.state == "missing-toolchain" => DoctorCheck {
            id: "toolchain".to_owned(),
            label: "Toolchain".to_owned(),
            status: DoctorStatus::Error,
            summary: format!(
                "The required toolchain {} is not installed.",
                status
                    .required_toolchain
                    .as_deref()
                    .unwrap_or("for this project")
            ),
            repair: status.repairs.first().map(|repair| DoctorRepair {
                id: repair.id.clone(),
                label: repair.label.clone(),
                description: repair.description.clone(),
                can_run: repair.can_run,
            }),
        },
        Ok(status) => match selected_toolchain(status) {
            Some(toolchain) => DoctorCheck {
                id: "toolchain".to_owned(),
                label: "Toolchain".to_owned(),
                status: DoctorStatus::Ok,
                summary: format!("Using {toolchain}."),
                repair: None,
            },
            None => DoctorCheck {
                id: "toolchain".to_owned(),
                label: "Toolchain".to_owned(),
                status: DoctorStatus::Error,
                summary: "No Lean toolchain is selected.".to_owned(),
                repair: Some(manual_repair(
                    "select-toolchain",
                    "Select a toolchain",
                    "Add a lean-toolchain file to the project or configure an Elan default.",
                )),
            },
        },
        Err(error) => DoctorCheck {
            id: "toolchain".to_owned(),
            label: "Toolchain".to_owned(),
            status: DoctorStatus::Error,
            summary: error.summary.clone(),
            repair: None,
        },
    }
}

fn executable_check(
    id: &str,
    label: &str,
    probe: Option<&Result<ProbeOutput, String>>,
    selected_toolchain: Option<&str>,
) -> DoctorCheck {
    match probe {
        Some(Ok(output)) => DoctorCheck {
            id: id.to_owned(),
            label: label.to_owned(),
            status: DoctorStatus::Ok,
            summary: output.version.clone(),
            repair: None,
        },
        Some(Err(_)) => DoctorCheck {
            id: id.to_owned(),
            label: label.to_owned(),
            status: DoctorStatus::Error,
            summary: format!("{label} could not start through the selected toolchain."),
            repair: Some(manual_repair(
                "repair-toolchain",
                "Repair toolchain",
                &format!(
                    "Run `elan toolchain install {}` in a terminal, then diagnose again.",
                    selected_toolchain.unwrap_or("<toolchain>")
                ),
            )),
        },
        None => unavailable_check(
            id,
            label,
            &format!("{label} cannot be checked until a toolchain is ready."),
        ),
    }
}

fn dependency_check(root: Option<&Path>, progress: &LakeProgress, can_run: bool) -> DoctorCheck {
    let Some(root) = root else {
        return unavailable_check(
            "dependencies",
            "Dependencies",
            "Open a local project to inspect dependencies.",
        );
    };
    if !root.join("lakefile.toml").is_file() && !root.join("lakefile.lean").is_file() {
        return unavailable_check(
            "dependencies",
            "Dependencies",
            "This project has no Lake configuration.",
        );
    }

    let repair = DoctorRepair {
        id: "update-dependencies".to_owned(),
        label: "Update dependencies".to_owned(),
        description: if can_run {
            "Run Lake update with the project-selected toolchain.".to_owned()
        } else {
            "Repair the project toolchain before updating dependencies.".to_owned()
        },
        can_run,
    };
    if progress_matches(Some(root), progress) && progress.operation == "fetch" && progress.running {
        return DoctorCheck {
            id: "dependencies".to_owned(),
            label: "Dependencies".to_owned(),
            status: DoctorStatus::Warning,
            summary: "Lake is updating dependencies.".to_owned(),
            repair: None,
        };
    }
    if progress_matches(Some(root), progress)
        && progress.operation == "fetch"
        && progress.succeeded == Some(false)
    {
        return DoctorCheck {
            id: "dependencies".to_owned(),
            label: "Dependencies".to_owned(),
            status: DoctorStatus::Error,
            summary: progress
                .failure
                .as_ref()
                .map(|failure| failure.summary.clone())
                .unwrap_or_else(|| progress.message.clone()),
            repair: Some(repair),
        };
    }
    let missing = missing_dependencies(root);
    if !missing.is_empty() {
        // No repair: `lake update` would also move the pinned revisions.
        return DoctorCheck {
            id: "dependencies".to_owned(),
            label: "Dependencies".to_owned(),
            status: DoctorStatus::Error,
            summary: format!(
                "Pinned dependencies are not downloaded: {}. Run `{}` in the project folder.",
                missing.join(", "),
                dependency_download_command(&missing)
            ),
            repair: None,
        };
    }
    if root.join("lake-manifest.json").is_file() {
        DoctorCheck {
            id: "dependencies".to_owned(),
            label: "Dependencies".to_owned(),
            status: DoctorStatus::Ok,
            summary: "The Lake dependency manifest is present.".to_owned(),
            repair: Some(repair),
        }
    } else {
        DoctorCheck {
            id: "dependencies".to_owned(),
            label: "Dependencies".to_owned(),
            status: DoctorStatus::Warning,
            summary: "Dependencies have not been resolved yet.".to_owned(),
            repair: Some(repair),
        }
    }
}

fn server_check(server_status: Option<&ServiceResult<ServerStatus>>, can_run: bool) -> DoctorCheck {
    let Some(server_status) = server_status else {
        return unavailable_check(
            "server",
            "Lean server",
            "Open a local project to inspect the Lean server.",
        );
    };
    match server_status {
        Ok(status) if status.state == "ready" => DoctorCheck {
            id: "server".to_owned(),
            label: "Lean server".to_owned(),
            status: DoctorStatus::Ok,
            summary: status.message.clone(),
            repair: None,
        },
        Ok(status) if status.state == "starting" => DoctorCheck {
            id: "server".to_owned(),
            label: "Lean server".to_owned(),
            status: DoctorStatus::Warning,
            summary: status.message.clone(),
            repair: None,
        },
        Ok(status) => DoctorCheck {
            id: "server".to_owned(),
            label: "Lean server".to_owned(),
            status: if status.state == "error" {
                DoctorStatus::Error
            } else {
                DoctorStatus::Warning
            },
            summary: status.message.clone(),
            repair: Some(DoctorRepair {
                id: "restart-server".to_owned(),
                label: if status.state == "offline" {
                    "Start server".to_owned()
                } else {
                    "Restart server".to_owned()
                },
                description: if can_run {
                    "Restart the managed Lean server for this workspace.".to_owned()
                } else {
                    "Repair the project toolchain before starting the Lean server.".to_owned()
                },
                can_run,
            }),
        },
        Err(error) => DoctorCheck {
            id: "server".to_owned(),
            label: "Lean server".to_owned(),
            status: DoctorStatus::Error,
            summary: error.summary.clone(),
            repair: None,
        },
    }
}

fn unavailable_check(id: &str, label: &str, summary: &str) -> DoctorCheck {
    DoctorCheck {
        id: id.to_owned(),
        label: label.to_owned(),
        status: DoctorStatus::Unavailable,
        summary: summary.to_owned(),
        repair: None,
    }
}

fn manual_repair(id: &str, label: &str, description: &str) -> DoctorRepair {
    DoctorRepair {
        id: id.to_owned(),
        label: label.to_owned(),
        description: description.to_owned(),
        can_run: false,
    }
}

fn overall_status(checks: &[DoctorCheck]) -> DoctorStatus {
    if checks
        .iter()
        .any(|check| check.status == DoctorStatus::Error)
    {
        DoctorStatus::Error
    } else if checks
        .iter()
        .any(|check| check.status == DoctorStatus::Warning)
    {
        DoctorStatus::Warning
    } else {
        DoctorStatus::Ok
    }
}

fn progress_matches(root: Option<&Path>, progress: &LakeProgress) -> bool {
    match (root, progress.project_path.as_deref()) {
        (Some(root), Some(project_path)) => root == Path::new(project_path),
        _ => false,
    }
}

fn probe_selected(
    elan: Option<&Path>,
    toolchain: Option<&str>,
    executable: &str,
) -> Option<Result<ProbeOutput, String>> {
    Some(run_toolchain_probe(elan?, toolchain?, executable))
}

fn probe_log(elan: &Path, toolchain: &str, executable: &str, label: &str) -> String {
    match run_toolchain_probe(elan, toolchain, executable) {
        Ok(output) => format!("{label} probe:\n{}", output.details),
        Err(error) => format!("{label} probe failed:\n{error}"),
    }
}

fn run_toolchain_probe(
    elan: &Path,
    toolchain: &str,
    executable: &str,
) -> Result<ProbeOutput, String> {
    let mut child = Command::new(elan)
        .args(["run", toolchain, executable, "--version"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start {}: {error}", elan.display()))?;
    let started = Instant::now();

    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < PROBE_TIMEOUT => {
                thread::sleep(Duration::from_millis(25));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "Timed out after {} seconds.",
                    PROBE_TIMEOUT.as_secs()
                ));
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Could not inspect the process: {error}"));
            }
        }
    };

    let stdout = read_pipe(child.stdout.take())?;
    let stderr = read_pipe(child.stderr.take())?;
    let details = [stdout.trim(), stderr.trim()]
        .into_iter()
        .filter(|output| !output.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if !status.success() {
        return Err(format!("exit status {status}\n{details}").trim().to_owned());
    }
    let version = details
        .lines()
        .next()
        .filter(|line| !line.trim().is_empty())
        .unwrap_or("Version output was empty.")
        .to_owned();
    Ok(ProbeOutput { version, details })
}

fn read_pipe<R: Read>(reader: Option<R>) -> Result<String, String> {
    let Some(reader) = reader else {
        return Ok(String::new());
    };
    let mut bytes = Vec::new();
    reader
        .take(MAX_PROBE_BYTES)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read process output: {error}"))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, time::SystemTime};

    #[test]
    fn missing_manifest_offers_a_safe_dependency_update() {
        let root = temporary_directory("doctor-dependencies");
        fs::write(root.join("lakefile.toml"), "name = \"ProofGarden\"\n").unwrap();

        let check = dependency_check(Some(&root), &LakeProgress::default(), true);

        assert_eq!(check.status, DoctorStatus::Warning);
        assert_eq!(check.repair.unwrap().id, "update-dependencies");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn dependency_failure_is_reported_only_for_the_current_project() {
        let root = temporary_directory("doctor-current-project");
        fs::write(root.join("lakefile.toml"), "name = \"ProofGarden\"\n").unwrap();
        let progress = LakeProgress {
            operation: "fetch".to_owned(),
            stage: "failed".to_owned(),
            message: "Lake could not update dependencies.".to_owned(),
            running: false,
            succeeded: Some(false),
            project_path: root.to_str().map(str::to_owned),
            failure: None,
        };

        let current = dependency_check(Some(&root), &progress, true);
        let other = temporary_directory("doctor-other-project");
        fs::write(other.join("lakefile.toml"), "name = \"Other\"\n").unwrap();
        let unrelated = dependency_check(Some(&other), &progress, true);

        assert_eq!(current.status, DoctorStatus::Error);
        assert_eq!(unrelated.status, DoctorStatus::Warning);
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(other).unwrap();
    }

    #[test]
    fn errors_determine_the_overall_status() {
        let checks = [
            unavailable_check("server", "Lean server", "No project open."),
            DoctorCheck {
                id: "lean".to_owned(),
                label: "Lean".to_owned(),
                status: DoctorStatus::Error,
                summary: "Lean failed.".to_owned(),
                repair: None,
            },
        ];

        assert_eq!(overall_status(&checks), DoctorStatus::Error);
    }

    #[test]
    fn matches_lake_progress_with_native_path_semantics() {
        let progress = LakeProgress {
            project_path: Some(
                PathBuf::from("workspace")
                    .join("ProofGarden")
                    .display()
                    .to_string(),
            ),
            ..LakeProgress::default()
        };

        assert!(progress_matches(
            Some(&PathBuf::from("workspace").join("ProofGarden")),
            &progress,
        ));
        assert!(!progress_matches(
            Some(Path::new("workspace/Other")),
            &progress
        ));
    }

    #[test]
    #[ignore = "requires LEANLANDER_LAKE_TOOLCHAIN and a locally installed Lean toolchain"]
    fn probes_real_lean_and_lake_versions() {
        let toolchain = std::env::var("LEANLANDER_LAKE_TOOLCHAIN").unwrap();
        let elan = toolchain::find_elan().unwrap();

        assert!(run_toolchain_probe(&elan, &toolchain, "lean")
            .unwrap()
            .version
            .contains("Lean"));
        assert!(!run_toolchain_probe(&elan, &toolchain, "lake")
            .unwrap()
            .version
            .is_empty());
    }

    #[test]
    #[ignore = "requires LEANLANDER_LAKE_TOOLCHAIN and a locally installed Lean toolchain"]
    fn diagnoses_a_real_installed_toolchain() {
        let toolchain = std::env::var("LEANLANDER_LAKE_TOOLCHAIN").unwrap();
        let root = temporary_directory("doctor-live-report");
        fs::write(root.join("lakefile.toml"), "name = \"ProofGarden\"\n").unwrap();
        fs::write(root.join("lake-manifest.json"), "{}\n").unwrap();

        let report = diagnose(
            Some(&root),
            Some(&toolchain),
            &LakeManager::default(),
            &ServerManager::default(),
        )
        .unwrap();

        assert_eq!(report.checks.len(), 6);
        assert_eq!(report.checks[0].status, DoctorStatus::Ok);
        assert_eq!(report.checks[1].status, DoctorStatus::Ok);
        assert_eq!(report.checks[2].status, DoctorStatus::Ok);
        assert_eq!(report.checks[3].status, DoctorStatus::Ok);
        assert_eq!(report.checks[4].status, DoctorStatus::Ok);
        assert_eq!(report.checks[5].status, DoctorStatus::Warning);
        fs::remove_dir_all(root).unwrap();
    }

    fn temporary_directory(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("leanlander-{label}-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
        path
    }
}
