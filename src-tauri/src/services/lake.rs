use super::{
    project::canonical_project_root,
    toolchain::{find_elan, select_toolchain},
    ServiceError, ServiceResult,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    env,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

const MAX_LOG_LINES: usize = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectTemplate {
    Lean,
    Mathlib,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectOptions {
    pub parent_path: PathBuf,
    pub name: String,
    pub template: ProjectTemplate,
    pub initialize_git: bool,
    pub toolchain: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationFailure {
    pub category: String,
    pub summary: String,
    pub suggestion: String,
    pub details: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LakeProgress {
    pub operation: String,
    pub stage: String,
    pub message: String,
    pub running: bool,
    pub succeeded: Option<bool>,
    pub project_path: Option<String>,
    pub failure: Option<OperationFailure>,
}

impl Default for LakeProgress {
    fn default() -> Self {
        Self {
            operation: "idle".to_owned(),
            stage: "idle".to_owned(),
            message: "No Lake operation is running.".to_owned(),
            running: false,
            succeeded: None,
            project_path: None,
            failure: None,
        }
    }
}

#[derive(Default)]
pub struct LakeManager {
    child: Arc<Mutex<Option<Child>>>,
    progress: Arc<Mutex<LakeProgress>>,
    active: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    log: Arc<Mutex<VecDeque<String>>>,
}

#[derive(Clone)]
struct OperationContext {
    child: Arc<Mutex<Option<Child>>>,
    progress: Arc<Mutex<LakeProgress>>,
    active: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    cancelled: Arc<AtomicBool>,
    log: Arc<Mutex<VecDeque<String>>>,
}

#[derive(Clone, Copy)]
enum ProjectOperation {
    Fetch,
    Build,
}

impl ProjectOperation {
    fn id(self) -> &'static str {
        match self {
            Self::Fetch => "fetch",
            Self::Build => "build",
        }
    }

    fn stage(self) -> &'static str {
        match self {
            Self::Fetch => "fetching",
            Self::Build => "building",
        }
    }

    fn message(self) -> &'static str {
        match self {
            Self::Fetch => "Updating project dependencies",
            Self::Build => "Building project",
        }
    }

    fn success_message(self) -> &'static str {
        match self {
            Self::Fetch => "Dependencies are up to date",
            Self::Build => "Build completed",
        }
    }

    fn lake_argument(self) -> &'static str {
        match self {
            Self::Fetch => "update",
            Self::Build => "build",
        }
    }
}

impl LakeManager {
    pub fn start_create(&self, mut options: CreateProjectOptions) -> ServiceResult<()> {
        validate_project_name(&options.name)?;
        options.parent_path = canonical_project_root(&options.parent_path)?;
        let project_path = target_path(&options);
        if project_path.exists() {
            return Err(ServiceError::new(
                "project-exists",
                "A file or folder already uses that project name.",
                "Choose a different project name or parent folder.",
                Some(project_path.display().to_string()),
            ));
        }
        let toolchain = select_toolchain(options.toolchain.as_deref())?;
        let elan = find_elan().ok_or_else(missing_lake_error)?;
        let git = if options.initialize_git {
            Some(find_executable("git").ok_or_else(|| {
                ServiceError::new(
                    "missing-git",
                    "Git was not found.",
                    "Install Git or create the project without Git initialization.",
                    None,
                )
            })?)
        } else {
            None
        };
        let context = self.begin(LakeProgress {
            operation: "create".to_owned(),
            stage: "creating".to_owned(),
            message: format!("Creating {}", options.name),
            running: true,
            succeeded: None,
            project_path: Some(path_to_string(&project_path)?),
            failure: None,
        })?;

        thread::spawn(move || {
            let result = run_create_pipeline(
                &options,
                &project_path,
                &toolchain,
                &elan,
                git.as_deref(),
                &context,
            );
            finish_operation(&context, result, "Project created", Some(&project_path));
        });
        Ok(())
    }

    pub fn start_fetch(
        &self,
        project_path: &Path,
        required_toolchain: Option<&str>,
    ) -> ServiceResult<()> {
        self.start_project_operation(ProjectOperation::Fetch, project_path, required_toolchain)
    }

    pub fn start_build(
        &self,
        project_path: &Path,
        required_toolchain: Option<&str>,
    ) -> ServiceResult<()> {
        self.start_project_operation(ProjectOperation::Build, project_path, required_toolchain)
    }

    pub fn progress(&self) -> ServiceResult<LakeProgress> {
        self.progress
            .lock()
            .map(|progress| progress.clone())
            .map_err(lake_lock_error)
    }

    pub fn diagnostic_log(&self) -> ServiceResult<Vec<String>> {
        self.log
            .lock()
            .map(|lines| lines.iter().cloned().collect())
            .map_err(lake_lock_error)
    }

    pub fn cancel(&self) -> ServiceResult<()> {
        let active = self.active.lock().map_err(lake_lock_error)?;
        let Some(cancelled) = active.as_ref() else {
            return Ok(());
        };
        cancelled.store(true, Ordering::Release);
        let mut child = self.child.lock().map_err(lake_lock_error)?;
        if let Some(child) = child.as_mut() {
            let _ = child.kill();
        }
        drop(child);
        let mut progress = self.progress.lock().map_err(lake_lock_error)?;
        if progress.running {
            progress.stage = "cancelling".to_owned();
            progress.message = format!("Cancelling {}", operation_label(&progress.operation));
        }
        Ok(())
    }

    fn start_project_operation(
        &self,
        operation: ProjectOperation,
        project_path: &Path,
        required_toolchain: Option<&str>,
    ) -> ServiceResult<()> {
        let root = canonical_project_root(project_path)?;
        require_lake_project(&root)?;
        let toolchain = select_toolchain(required_toolchain)?;
        let elan = find_elan().ok_or_else(missing_lake_error)?;
        let context = self.begin(LakeProgress {
            operation: operation.id().to_owned(),
            stage: operation.stage().to_owned(),
            message: operation.message().to_owned(),
            running: true,
            succeeded: None,
            project_path: Some(path_to_string(&root)?),
            failure: None,
        })?;

        thread::spawn(move || {
            let arguments = elan_lake_arguments(&toolchain, &[operation.lake_argument()]);
            let result = run_process(
                &elan,
                &arguments,
                &root,
                operation.stage(),
                operation.message(),
                operation.id(),
                &context,
            );
            finish_operation(&context, result, operation.success_message(), Some(&root));
        });
        Ok(())
    }

    fn begin(&self, progress: LakeProgress) -> ServiceResult<OperationContext> {
        let mut active = self.active.lock().map_err(lake_lock_error)?;
        let child_running = self.child.lock().map_err(lake_lock_error)?.is_some();
        let mut current = self.progress.lock().map_err(lake_lock_error)?;
        if active.is_some() || child_running || current.running {
            return Err(ServiceError::new(
                "operation-in-progress",
                "Another Lake operation is already running.",
                "Wait for it to finish or cancel it before starting another.",
                None,
            ));
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        *active = Some(Arc::clone(&cancelled));
        self.log.lock().map_err(lake_lock_error)?.clear();
        *current = progress;
        Ok(OperationContext {
            child: Arc::clone(&self.child),
            progress: Arc::clone(&self.progress),
            active: Arc::clone(&self.active),
            cancelled,
            log: Arc::clone(&self.log),
        })
    }
}

fn run_create_pipeline(
    options: &CreateProjectOptions,
    project_path: &Path,
    toolchain: &str,
    elan: &Path,
    git: Option<&Path>,
    context: &OperationContext,
) -> Result<(), OperationFailure> {
    let create = create_arguments(options);
    run_process(
        elan,
        &elan_lake_arguments(
            toolchain,
            &create.iter().map(String::as_str).collect::<Vec<_>>(),
        ),
        &options.parent_path,
        "creating",
        &format!("Creating {}", options.name),
        "create",
        context,
    )?;

    if let Some(git) = git {
        run_process(
            git,
            &["init".to_owned()],
            project_path,
            "initializingGit",
            "Initializing Git repository",
            "git",
            context,
        )?;
    }

    run_process(
        elan,
        &elan_lake_arguments(toolchain, &["update"]),
        project_path,
        "fetching",
        "Fetching project dependencies",
        "fetch",
        context,
    )
}

fn run_process(
    executable: &Path,
    arguments: &[String],
    current_directory: &Path,
    stage: &str,
    message: &str,
    operation: &str,
    context: &OperationContext,
) -> Result<(), OperationFailure> {
    if context.cancelled.load(Ordering::Acquire) {
        return Err(cancelled_failure());
    }
    update_stage(&context.progress, stage, message);

    let mut command = Command::new(executable);
    command
        .args(arguments)
        .current_dir(current_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut process = command.spawn().map_err(|error| OperationFailure {
        category: "process".to_owned(),
        summary: format!("Could not start {}.", operation_label(operation)),
        suggestion: "Check that the selected Lean toolchain is installed and try again.".to_owned(),
        details: Some(format!("{}: {error}", executable.display())),
    })?;
    let stdout = process.stdout.take();
    let stderr = process.stderr.take();
    *context.child.lock().map_err(operation_lock_failure)? = Some(process);

    let output = Arc::new(Mutex::new(VecDeque::new()));
    let readers = [
        stdout.map(ProcessOutput::Stdout),
        stderr.map(ProcessOutput::Stderr),
    ]
    .into_iter()
    .flatten()
    .map(|reader| {
        stream_process_output(
            reader,
            Arc::clone(&context.progress),
            Arc::clone(&output),
            Arc::clone(&context.log),
        )
    })
    .collect::<Vec<_>>();
    let status = wait_for_process(context)?;
    for reader in readers {
        let _ = reader.join();
    }
    let details = output
        .lock()
        .map(|lines| lines.iter().cloned().collect::<Vec<_>>().join("\n"))
        .unwrap_or_default();

    if status.success() {
        Ok(())
    } else if context.cancelled.load(Ordering::Acquire) {
        Err(cancelled_failure())
    } else {
        Err(translate_failure(operation, &details, status))
    }
}

enum ProcessOutput {
    Stdout(std::process::ChildStdout),
    Stderr(std::process::ChildStderr),
}

fn stream_process_output(
    output: ProcessOutput,
    progress: Arc<Mutex<LakeProgress>>,
    log: Arc<Mutex<VecDeque<String>>>,
    diagnostic_log: Arc<Mutex<VecDeque<String>>>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let reader: Box<dyn std::io::Read> = match output {
            ProcessOutput::Stdout(stdout) => Box::new(stdout),
            ProcessOutput::Stderr(stderr) => Box::new(stderr),
        };
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(mut current) = progress.lock() {
                if current.running {
                    current.message = line.clone();
                }
            }
            if let Ok(mut lines) = log.lock() {
                append_log_line(&mut lines, line.clone());
            }
            if let Ok(mut lines) = diagnostic_log.lock() {
                append_log_line(&mut lines, line);
            }
        }
    })
}

fn append_log_line(lines: &mut VecDeque<String>, line: String) {
    if lines.len() == MAX_LOG_LINES {
        lines.pop_front();
    }
    lines.push_back(line);
}

fn wait_for_process(context: &OperationContext) -> Result<ExitStatus, OperationFailure> {
    loop {
        let status = {
            let mut child = context.child.lock().map_err(operation_lock_failure)?;
            let process = child.as_mut().ok_or_else(|| OperationFailure {
                category: "internal".to_owned(),
                summary: "Lake process state was lost.".to_owned(),
                suggestion: "Restart LeanLander and try again.".to_owned(),
                details: None,
            })?;
            if context.cancelled.load(Ordering::Acquire) {
                let _ = process.kill();
            }
            match process.try_wait() {
                Ok(Some(status)) => {
                    *child = None;
                    Some(Ok(status))
                }
                Ok(None) => None,
                Err(error) => {
                    let _ = process.kill();
                    let _ = process.wait();
                    *child = None;
                    Some(Err(OperationFailure {
                        category: "process".to_owned(),
                        summary: "Could not monitor the Lake process.".to_owned(),
                        suggestion: "Restart LeanLander and try again.".to_owned(),
                        details: Some(error.to_string()),
                    }))
                }
            }
        };

        if let Some(status) = status {
            return status;
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn finish_operation(
    context: &OperationContext,
    result: Result<(), OperationFailure>,
    success_message: &str,
    project_path: Option<&Path>,
) {
    let Ok(mut active) = context.active.lock() else {
        return;
    };
    if !active
        .as_ref()
        .is_some_and(|cancelled| Arc::ptr_eq(cancelled, &context.cancelled))
    {
        return;
    }
    let Ok(mut current) = context.progress.lock() else {
        return;
    };

    match result {
        Ok(()) => {
            current.stage = "complete".to_owned();
            current.message = success_message.to_owned();
            current.running = false;
            current.succeeded = Some(true);
            current.project_path = project_path
                .and_then(|path| path.to_str())
                .map(str::to_owned);
            current.failure = None;
        }
        Err(failure) if failure.category == "cancelled" => {
            current.stage = "cancelled".to_owned();
            current.message = format!("{} cancelled", operation_label(&current.operation));
            current.running = false;
            current.succeeded = Some(false);
            current.failure = None;
        }
        Err(failure) => {
            current.stage = "failed".to_owned();
            current.message = failure.summary.clone();
            current.running = false;
            current.succeeded = Some(false);
            current.failure = Some(failure);
        }
    }
    *active = None;
}

fn update_stage(progress: &Arc<Mutex<LakeProgress>>, stage: &str, message: &str) {
    if let Ok(mut progress) = progress.lock() {
        if progress.running {
            progress.stage = stage.to_owned();
            progress.message = message.to_owned();
        }
    }
}

fn elan_lake_arguments(toolchain: &str, lake_arguments: &[&str]) -> Vec<String> {
    ["run", toolchain, "lake"]
        .into_iter()
        .chain(lake_arguments.iter().copied())
        .map(str::to_owned)
        .collect()
}

fn find_executable(name: &str) -> Option<PathBuf> {
    let executable = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_owned()
    };
    let path = env::var_os("PATH")?;
    env::split_paths(&path)
        .map(|directory| directory.join(&executable))
        .find(|path| path.is_file())
}

fn translate_failure(operation: &str, details: &str, status: ExitStatus) -> OperationFailure {
    let normalized = details.to_ascii_lowercase();
    let (category, summary, suggestion) = if operation == "git" {
        (
            "git",
            "Git could not initialize the new project.",
            "Check the Git installation and the destination folder permissions.",
        )
    } else if [
        "could not resolve host",
        "failed to connect",
        "network is unreachable",
        "timed out",
        "failed to clone",
    ]
    .iter()
    .any(|pattern| normalized.contains(pattern))
    {
        (
            "network",
            "Lake could not reach a dependency source.",
            "Check the network connection, then update dependencies again.",
        )
    } else if operation == "fetch" {
        (
            "dependency",
            "Lake could not update project dependencies.",
            "Review the package revisions in the Lake configuration and try again.",
        )
    } else if operation == "build" {
        (
            "build",
            "Lake could not build the project.",
            "Review the first Lean error in the operation details, fix it, and build again.",
        )
    } else {
        (
            "project-creation",
            "Lake could not create the project.",
            "Choose an empty destination and verify that the selected toolchain supports this template.",
        )
    };

    OperationFailure {
        category: category.to_owned(),
        summary: summary.to_owned(),
        suggestion: suggestion.to_owned(),
        details: Some(format!("exit status {status}\n{details}").trim().to_owned()),
    }
}

fn operation_label(operation: &str) -> &str {
    match operation {
        "create" => "Project creation",
        "fetch" => "Dependency update",
        "build" => "Build",
        "git" => "Git initialization",
        _ => "Lake operation",
    }
}

fn cancelled_failure() -> OperationFailure {
    OperationFailure {
        category: "cancelled".to_owned(),
        summary: "Lake operation cancelled.".to_owned(),
        suggestion: "Start the operation again when ready.".to_owned(),
        details: None,
    }
}

fn missing_lake_error() -> ServiceError {
    ServiceError::new(
        "missing-elan",
        "Lake could not be located because Elan was not found.",
        "Install Elan and the project toolchain, then try again.",
        None,
    )
}

fn path_to_string(path: &Path) -> ServiceResult<String> {
    path.to_str().map(str::to_owned).ok_or_else(|| {
        ServiceError::new(
            "unsupported-path",
            "The project path is not valid Unicode.",
            "Choose a project location LeanLander can display.",
            Some(path.display().to_string()),
        )
    })
}

fn lake_lock_error<T>(error: std::sync::PoisonError<T>) -> ServiceError {
    ServiceError::new(
        "internal",
        "Lake operation state is unavailable.",
        "Restart LeanLander and try again.",
        Some(error.to_string()),
    )
}

fn operation_lock_failure<T>(error: std::sync::PoisonError<T>) -> OperationFailure {
    OperationFailure {
        category: "internal".to_owned(),
        summary: "Lake operation state is unavailable.".to_owned(),
        suggestion: "Restart LeanLander and try again.".to_owned(),
        details: Some(error.to_string()),
    }
}

fn validate_project_name(name: &str) -> ServiceResult<()> {
    let mut characters = name.chars();
    let valid = name.len() <= 64
        && characters
            .next()
            .is_some_and(|character| character.is_ascii_alphabetic())
        && characters.all(|character| character.is_ascii_alphanumeric() || character == '_');

    if valid {
        Ok(())
    } else {
        Err(ServiceError::new(
            "invalid-project-name",
            "The project name is invalid.",
            "Start with a letter and use only ASCII letters, numbers, or underscores.",
            Some(name.to_owned()),
        ))
    }
}

fn create_arguments(options: &CreateProjectOptions) -> Vec<String> {
    vec![
        "new".to_owned(),
        options.name.clone(),
        match options.template {
            ProjectTemplate::Lean => "std",
            ProjectTemplate::Mathlib => "math",
        }
        .to_owned(),
    ]
}

fn target_path(options: &CreateProjectOptions) -> PathBuf {
    options.parent_path.join(&options.name)
}

fn require_lake_project(root: &Path) -> ServiceResult<()> {
    if root.join("lakefile.toml").is_file() || root.join("lakefile.lean").is_file() {
        Ok(())
    } else {
        Err(ServiceError::new(
            "missing-lakefile",
            "This folder is not a Lake project.",
            "Open a project containing lakefile.toml or lakefile.lean.",
            Some(root.display().to_string()),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{Instant, SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn validates_lean_project_names() {
        assert!(validate_project_name("ProofGarden_2").is_ok());
        for invalid in ["", "2Proof", "Proof Garden", "../Proof", "Proof-Garden"] {
            assert!(
                validate_project_name(invalid).is_err(),
                "accepted {invalid}"
            );
        }
        assert!(validate_project_name(&"a".repeat(65)).is_err());
    }

    #[test]
    fn plans_supported_lake_templates() {
        let mut options = CreateProjectOptions {
            parent_path: PathBuf::from("/tmp"),
            name: "ProofGarden".to_owned(),
            template: ProjectTemplate::Lean,
            initialize_git: true,
            toolchain: Some("leanprover/lean4:v4.14.0".to_owned()),
        };
        assert_eq!(create_arguments(&options), ["new", "ProofGarden", "std"]);
        assert_eq!(target_path(&options), PathBuf::from("/tmp/ProofGarden"));

        options.template = ProjectTemplate::Mathlib;
        assert_eq!(create_arguments(&options), ["new", "ProofGarden", "math"]);
    }

    #[test]
    fn translates_network_and_build_failures() {
        let network_status = failure_status();
        let network = translate_failure(
            "fetch",
            "fatal: could not resolve host github.com",
            network_status,
        );
        assert_eq!(network.category, "network");

        let build = translate_failure("build", "Main.lean:2: unknown identifier", failure_status());
        assert_eq!(build.category, "build");
        assert!(build.suggestion.contains("first Lean error"));
    }

    #[test]
    fn late_cancellation_does_not_override_success() {
        let cancelled = Arc::new(AtomicBool::new(true));
        let progress = Arc::new(Mutex::new(LakeProgress {
            operation: "create".to_owned(),
            stage: "creating".to_owned(),
            message: "Creating ProofGarden".to_owned(),
            running: true,
            succeeded: None,
            project_path: None,
            failure: None,
        }));
        let active = Arc::new(Mutex::new(Some(Arc::clone(&cancelled))));
        let context = OperationContext {
            child: Arc::new(Mutex::new(None)),
            progress: Arc::clone(&progress),
            active: Arc::clone(&active),
            cancelled,
            log: Arc::new(Mutex::new(VecDeque::new())),
        };

        finish_operation(
            &context,
            Ok(()),
            "Project created",
            Some(Path::new("/tmp/ProofGarden")),
        );

        let result = progress.lock().unwrap().clone();
        assert_eq!(result.stage, "complete");
        assert_eq!(result.succeeded, Some(true));
        assert!(active.lock().unwrap().is_none());
    }

    #[test]
    fn cancelled_worker_reports_cancellation_without_a_failure() {
        let cancelled = Arc::new(AtomicBool::new(true));
        let progress = Arc::new(Mutex::new(LakeProgress {
            operation: "fetch".to_owned(),
            stage: "cancelling".to_owned(),
            message: "Cancelling dependency update".to_owned(),
            running: true,
            succeeded: None,
            project_path: None,
            failure: None,
        }));
        let active = Arc::new(Mutex::new(Some(Arc::clone(&cancelled))));
        let context = OperationContext {
            child: Arc::new(Mutex::new(None)),
            progress: Arc::clone(&progress),
            active,
            cancelled,
            log: Arc::new(Mutex::new(VecDeque::new())),
        };

        finish_operation(&context, Err(cancelled_failure()), "unused", None);

        let result = progress.lock().unwrap().clone();
        assert_eq!(result.stage, "cancelled");
        assert_eq!(result.succeeded, Some(false));
        assert!(result.failure.is_none());
    }

    #[test]
    fn diagnostic_log_keeps_only_the_latest_lines() {
        let manager = LakeManager::default();
        {
            let mut log = manager.log.lock().unwrap();
            for index in 0..=MAX_LOG_LINES {
                append_log_line(&mut log, format!("line {index}"));
            }
        }

        let log = manager.diagnostic_log().unwrap();
        assert_eq!(log.len(), MAX_LOG_LINES);
        assert_eq!(log.first().map(String::as_str), Some("line 1"));
        assert_eq!(log.last().map(String::as_str), Some("line 300"));
    }

    #[test]
    #[ignore = "requires LEANLANDER_LAKE_TOOLCHAIN and a locally installed Lean toolchain"]
    fn creates_updates_and_builds_a_real_lake_project() {
        let toolchain = std::env::var("LEANLANDER_LAKE_TOOLCHAIN").unwrap();
        let parent = temporary_directory("live-lake");
        let project = parent.join("ProofGarden");
        let manager = LakeManager::default();

        manager
            .start_create(CreateProjectOptions {
                parent_path: parent.clone(),
                name: "ProofGarden".to_owned(),
                template: ProjectTemplate::Lean,
                initialize_git: false,
                toolchain: Some(toolchain.clone()),
            })
            .unwrap();
        let created = wait_for_completion(&manager);
        assert_eq!(created.succeeded, Some(true), "{created:?}");
        assert!(project.join("lakefile.toml").is_file() || project.join("lakefile.lean").is_file());
        assert!(project.join("lean-toolchain").is_file());

        manager.start_build(&project, Some(&toolchain)).unwrap();
        let built = wait_for_completion(&manager);
        assert_eq!(built.succeeded, Some(true), "{built:?}");

        fs::remove_dir_all(parent).unwrap();
    }

    fn wait_for_completion(manager: &LakeManager) -> LakeProgress {
        let started = Instant::now();
        loop {
            let progress = manager.progress().unwrap();
            if !progress.running {
                return progress;
            }
            assert!(started.elapsed() < Duration::from_secs(60), "{progress:?}");
            thread::sleep(Duration::from_millis(100));
        }
    }

    fn temporary_directory(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("leanlander-{label}-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[cfg(unix)]
    fn failure_status() -> ExitStatus {
        use std::os::unix::process::ExitStatusExt;
        ExitStatus::from_raw(1 << 8)
    }

    #[cfg(windows)]
    fn failure_status() -> ExitStatus {
        use std::os::windows::process::ExitStatusExt;
        ExitStatus::from_raw(1)
    }
}
