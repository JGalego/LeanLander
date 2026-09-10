use super::{
    project::{canonical_project_root, resolve_project_file},
    toolchain::{find_elan, inspect, validate_toolchain_name},
    ServiceError, ServiceResult,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    io::{self, BufRead, BufReader, BufWriter, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::Duration,
};
use url::Url;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_LOG_LINES: usize = 200;
const MAX_MESSAGE_BYTES: usize = 64 * 1024 * 1024;

type PendingRequests = Arc<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub state: String,
    pub message: String,
    pub toolchain: Option<String>,
    pub version: Option<String>,
    pub capabilities: Vec<String>,
}

impl ServerStatus {
    fn offline() -> Self {
        Self {
            state: "offline".to_owned(),
            message: "Lean server offline".to_owned(),
            toolchain: None,
            version: None,
            capabilities: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LanguageFeature {
    Hover,
    Completion,
    Definition,
    References,
    DocumentSymbols,
}

#[derive(Default)]
pub struct ServerManager {
    servers: Mutex<HashMap<PathBuf, Arc<ServerConnection>>>,
}

struct ServerConnection {
    writer: Arc<Mutex<BufWriter<ChildStdin>>>,
    child: Mutex<Child>,
    pending: PendingRequests,
    next_id: AtomicU64,
    diagnostics: Arc<Mutex<HashMap<String, Vec<Value>>>>,
    documents: Mutex<HashMap<String, i64>>,
    rpc_sessions: Mutex<HashMap<String, Value>>,
    status: Arc<Mutex<ServerStatus>>,
    stderr_log: Arc<Mutex<VecDeque<String>>>,
}

impl ServerManager {
    pub fn start(
        &self,
        project_path: &Path,
        required_toolchain: Option<&str>,
    ) -> ServiceResult<ServerStatus> {
        let root = canonical_project_root(project_path)?;
        let mut servers = self.servers.lock().map_err(server_lock_error)?;

        if let Some(connection) = servers.get(&root) {
            let status = connection.status()?;
            if status.state == "ready" || status.state == "starting" {
                return Ok(status);
            }
        }
        if let Some(connection) = servers.remove(&root) {
            let _ = connection.terminate();
        }

        let toolchain = select_toolchain(required_toolchain)?;
        let connection = Arc::new(ServerConnection::spawn(&root, &toolchain)?);
        if let Err(error) = connection.initialize(&root) {
            let _ = connection.terminate();
            return Err(error);
        }
        let status = connection.status()?;
        servers.insert(root, connection);
        Ok(status)
    }

    pub fn status(&self, project_path: &Path) -> ServiceResult<ServerStatus> {
        let root = canonical_project_root(project_path)?;
        let servers = self.servers.lock().map_err(server_lock_error)?;
        match servers.get(&root) {
            Some(connection) => connection.status(),
            None => Ok(ServerStatus::offline()),
        }
    }

    pub fn stop(&self, project_path: &Path) -> ServiceResult<()> {
        let root = canonical_project_root(project_path)?;
        let connection = self
            .servers
            .lock()
            .map_err(server_lock_error)?
            .remove(&root);
        if let Some(connection) = connection {
            connection.shutdown()?;
        }
        Ok(())
    }

    pub fn sync_document(
        &self,
        project_path: &Path,
        relative_path: &Path,
        content: &str,
        version: i64,
    ) -> ServiceResult<i64> {
        let (root, source) = resolve_project_file(project_path, relative_path)?;
        self.connection(&root)?
            .sync_document(file_uri(&source)?, content, version)
    }

    pub fn close_document(&self, project_path: &Path, relative_path: &Path) -> ServiceResult<()> {
        let (root, source) = resolve_project_file(project_path, relative_path)?;
        self.connection(&root)?.close_document(file_uri(&source)?)
    }

    pub fn diagnostics(
        &self,
        project_path: &Path,
        relative_path: &Path,
    ) -> ServiceResult<Vec<Value>> {
        let (root, source) = resolve_project_file(project_path, relative_path)?;
        self.connection(&root)?.diagnostics(&file_uri(&source)?)
    }

    pub fn request_language_feature(
        &self,
        project_path: &Path,
        relative_path: &Path,
        feature: LanguageFeature,
        line: u32,
        character: u32,
    ) -> ServiceResult<Value> {
        let (root, source) = resolve_project_file(project_path, relative_path)?;
        self.connection(&root)?.request_language_feature(
            feature,
            &file_uri(&source)?,
            line,
            character,
        )
    }

    pub fn proof_state(
        &self,
        project_path: &Path,
        relative_path: &Path,
        line: u32,
        character: u32,
    ) -> ServiceResult<ProofState> {
        let (root, source) = resolve_project_file(project_path, relative_path)?;
        self.connection(&root)?
            .proof_state(&file_uri(&source)?, line, character)
    }

    fn connection(&self, root: &Path) -> ServiceResult<Arc<ServerConnection>> {
        self.servers
            .lock()
            .map_err(server_lock_error)?
            .get(root)
            .cloned()
            .ok_or_else(|| {
                ServiceError::new(
                    "lean-server",
                    "The Lean server is not running for this project.",
                    "Wait for the server to start, then try again.",
                    Some(root.display().to_string()),
                )
            })
    }
}

impl ServerConnection {
    fn spawn(root: &Path, toolchain: &str) -> ServiceResult<Self> {
        let elan = find_elan().ok_or_else(|| {
            ServiceError::new(
                "missing-elan",
                "Elan was not found.",
                "Install Elan before starting the Lean server.",
                None,
            )
        })?;
        let workspace_folders = json!([{
            "uri": directory_uri(root)?,
            "name": project_name(root)
        }]);
        let arguments = server_arguments(root, toolchain);
        let mut child = Command::new(&elan)
            .args(&arguments)
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| ServiceError::io("start the Lean server", &elan, &error))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| process_pipe_error("input"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| process_pipe_error("output"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| process_pipe_error("error output"))?;
        let writer = Arc::new(Mutex::new(BufWriter::new(stdin)));
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let diagnostics = Arc::new(Mutex::new(HashMap::new()));
        let stderr_log = Arc::new(Mutex::new(VecDeque::new()));
        let status = Arc::new(Mutex::new(ServerStatus {
            state: "starting".to_owned(),
            message: "Starting Lean server".to_owned(),
            toolchain: Some(toolchain.to_owned()),
            version: toolchain_version(toolchain),
            capabilities: Vec::new(),
        }));

        spawn_stdout_reader(
            stdout,
            Arc::clone(&writer),
            Arc::clone(&pending),
            Arc::clone(&diagnostics),
            Arc::clone(&status),
            Arc::clone(&stderr_log),
            workspace_folders,
        );
        spawn_log_reader(stderr, Arc::clone(&stderr_log));

        Ok(Self {
            writer,
            child: Mutex::new(child),
            pending,
            next_id: AtomicU64::new(1),
            diagnostics,
            documents: Mutex::new(HashMap::new()),
            rpc_sessions: Mutex::new(HashMap::new()),
            status,
            stderr_log,
        })
    }

    fn initialize(&self, root: &Path) -> ServiceResult<()> {
        let root_uri = directory_uri(root)?;
        let result = self.request(
            "initialize",
            json!({
                "processId": std::process::id(),
                "clientInfo": {"name": "LeanLander", "version": env!("CARGO_PKG_VERSION")},
                "rootUri": root_uri,
                "workspaceFolders": [{"uri": root_uri, "name": project_name(root)}],
                "capabilities": {
                    "workspace": {"configuration": true, "workspaceFolders": true},
                    "textDocument": {
                        "publishDiagnostics": {"relatedInformation": true, "versionSupport": true},
                        "hover": {"contentFormat": ["markdown", "plaintext"]},
                        "completion": {"completionItem": {"snippetSupport": false}},
                        "definition": {"linkSupport": true},
                        "documentSymbol": {"hierarchicalDocumentSymbolSupport": true}
                    }
                }
            }),
        )?;
        self.notify("initialized", json!({}))?;

        let mut status = self.status.lock().map_err(server_lock_error)?;
        status.state = "ready".to_owned();
        status.message = "Lean server ready".to_owned();
        status.capabilities = detected_capabilities(&result);
        if let Some(version) = result
            .pointer("/serverInfo/version")
            .and_then(Value::as_str)
        {
            status.version = Some(version.to_owned());
        }
        Ok(())
    }

    fn status(&self) -> ServiceResult<ServerStatus> {
        self.status
            .lock()
            .map(|status| status.clone())
            .map_err(server_lock_error)
    }

    fn sync_document(&self, uri: String, content: &str, version: i64) -> ServiceResult<i64> {
        let mut documents = self.documents.lock().map_err(server_lock_error)?;
        let next_version = documents
            .get(&uri)
            .map_or(version.max(1), |current| version.max(current + 1));
        let method;
        let params;

        if documents.contains_key(&uri) {
            method = "textDocument/didChange";
            params = json!({
                "textDocument": {"uri": uri, "version": next_version},
                "contentChanges": [{"text": content}]
            });
        } else {
            method = "textDocument/didOpen";
            params = json!({
                "textDocument": {
                    "uri": uri,
                    "languageId": "lean4",
                    "version": next_version,
                    "text": content
                }
            });
        }

        self.notify(method, params)?;
        documents.insert(uri, next_version);
        Ok(next_version)
    }

    fn close_document(&self, uri: String) -> ServiceResult<()> {
        let was_open = self
            .documents
            .lock()
            .map_err(server_lock_error)?
            .remove(&uri)
            .is_some();
        self.rpc_sessions
            .lock()
            .map_err(server_lock_error)?
            .remove(&uri);
        self.diagnostics
            .lock()
            .map_err(server_lock_error)?
            .remove(&uri);

        if was_open {
            self.notify(
                "textDocument/didClose",
                json!({"textDocument": {"uri": uri}}),
            )?;
        }
        Ok(())
    }

    fn diagnostics(&self, uri: &str) -> ServiceResult<Vec<Value>> {
        self.diagnostics
            .lock()
            .map_err(server_lock_error)
            .map(|all| all.get(uri).cloned().unwrap_or_default())
    }

    fn request_language_feature(
        &self,
        feature: LanguageFeature,
        uri: &str,
        line: u32,
        character: u32,
    ) -> ServiceResult<Value> {
        let text_document = json!({"uri": uri});
        let position = json!({"line": line, "character": character});
        let (method, params) = match feature {
            LanguageFeature::Hover => (
                "textDocument/hover",
                json!({"textDocument": text_document, "position": position}),
            ),
            LanguageFeature::Completion => (
                "textDocument/completion",
                json!({
                    "textDocument": text_document,
                    "position": position,
                    "context": {"triggerKind": 1}
                }),
            ),
            LanguageFeature::Definition => (
                "textDocument/definition",
                json!({"textDocument": text_document, "position": position}),
            ),
            LanguageFeature::References => (
                "textDocument/references",
                json!({
                    "textDocument": text_document,
                    "position": position,
                    "context": {"includeDeclaration": true}
                }),
            ),
            LanguageFeature::DocumentSymbols => (
                "textDocument/documentSymbol",
                json!({"textDocument": text_document}),
            ),
        };
        self.request(method, params)
    }

    fn proof_state(&self, uri: &str, line: u32, character: u32) -> ServiceResult<ProofState> {
        ProofCompatibilityAdapter::request(self, uri, line, character)
    }

    fn interactive_goals(&self, uri: &str, line: u32, character: u32) -> ServiceResult<Value> {
        let session_id = self.rpc_session(uri)?;
        self.notify(
            "$/lean/rpc/keepAlive",
            json!({"uri": uri, "sessionId": session_id}),
        )?;
        let params = json!({
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
            "sessionId": session_id,
            "method": "Lean.Widget.getInteractiveGoals",
            "params": {
                "textDocument": {"uri": uri},
                "position": {"line": line, "character": character}
            }
        });

        match self.request("$/lean/rpc/call", params.clone()) {
            Ok(value) => Ok(value),
            Err(_) => {
                self.rpc_sessions
                    .lock()
                    .map_err(server_lock_error)?
                    .remove(uri);
                let session_id = self.rpc_session(uri)?;
                let mut retry = params;
                retry["sessionId"] = json!(session_id);
                self.request("$/lean/rpc/call", retry)
            }
        }
    }

    fn rpc_session(&self, uri: &str) -> ServiceResult<Value> {
        if let Some(session_id) = self
            .rpc_sessions
            .lock()
            .map_err(server_lock_error)?
            .get(uri)
            .cloned()
        {
            return Ok(session_id);
        }

        let response = self.request("$/lean/rpc/connect", json!({"uri": uri}))?;
        let session_id = response
            .get("sessionId")
            .filter(|value| {
                value.as_u64().is_some()
                    || value
                        .as_str()
                        .is_some_and(|value| value.parse::<u64>().is_ok())
            })
            .cloned()
            .ok_or_else(|| {
                protocol_error(&format!(
                    "RPC connection did not include a usable sessionId: {response}"
                ))
            })?;
        self.rpc_sessions
            .lock()
            .map_err(server_lock_error)?
            .insert(uri.to_owned(), session_id.clone());
        Ok(session_id)
    }

    fn request(&self, method: &str, params: Value) -> ServiceResult<Value> {
        self.request_with_timeout(method, params, REQUEST_TIMEOUT)
    }

    fn request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> ServiceResult<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = mpsc::channel();
        self.pending
            .lock()
            .map_err(server_lock_error)?
            .insert(id, sender);
        if let Err(error) = self.send(json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        })) {
            self.pending.lock().map_err(server_lock_error)?.remove(&id);
            return Err(error);
        }

        match receiver.recv_timeout(timeout) {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(error)) => Err(ServiceError::new(
                "lean-protocol",
                format!("Lean rejected the {method} request."),
                "Wait for the file to finish processing, then try again.",
                Some(debug_detail(&error, &self.debug_tail())),
            )),
            Err(error) => {
                self.pending.lock().map_err(server_lock_error)?.remove(&id);
                Err(ServiceError::new(
                    "lean-timeout",
                    format!("Lean did not answer the {method} request."),
                    "Restart the Lean server if it remains unresponsive.",
                    Some(debug_detail(&error.to_string(), &self.debug_tail())),
                ))
            }
        }
    }

    fn notify(&self, method: &str, params: Value) -> ServiceResult<()> {
        self.send(json!({"jsonrpc": "2.0", "method": method, "params": params}))
    }

    fn send(&self, message: Value) -> ServiceResult<()> {
        let mut writer = self.writer.lock().map_err(server_lock_error)?;
        write_message(&mut *writer, &message).map_err(|error| {
            ServiceError::new(
                "lean-server",
                "Could not communicate with the Lean server.",
                "Restart the Lean server and try again.",
                Some(error.to_string()),
            )
        })
    }

    fn shutdown(&self) -> ServiceResult<()> {
        let document_uris = self
            .documents
            .lock()
            .map_err(server_lock_error)?
            .drain()
            .map(|(uri, _)| uri)
            .collect::<Vec<_>>();
        for uri in document_uris {
            let _ = self.notify(
                "textDocument/didClose",
                json!({"textDocument": {"uri": uri}}),
            );
        }
        self.rpc_sessions.lock().map_err(server_lock_error)?.clear();
        let _ = self.request_with_timeout("shutdown", Value::Null, SHUTDOWN_TIMEOUT);
        let _ = self.notify("exit", Value::Null);
        self.terminate()
    }

    fn terminate(&self) -> ServiceResult<()> {
        let mut child = self.child.lock().map_err(server_lock_error)?;
        if child
            .try_wait()
            .map_err(|error| process_error("inspect", error))?
            .is_none()
        {
            child.kill().map_err(|error| process_error("stop", error))?;
        }
        let _ = child.wait();
        if let Ok(mut status) = self.status.lock() {
            status.state = "offline".to_owned();
            status.message = "Lean server offline".to_owned();
        }
        Ok(())
    }

    fn debug_tail(&self) -> String {
        self.stderr_log
            .lock()
            .map(|lines| lines.iter().cloned().collect::<Vec<_>>().join("\n"))
            .unwrap_or_default()
    }
}

struct ProofCompatibilityAdapter;

impl ProofCompatibilityAdapter {
    fn request(
        connection: &ServerConnection,
        uri: &str,
        line: u32,
        character: u32,
    ) -> ServiceResult<ProofState> {
        match connection.interactive_goals(uri, line, character) {
            Ok(value) => proof_state_from_rpc(&value),
            Err(interactive_error) => {
                let fallback = connection.request(
                    "$/lean/plainGoal",
                    json!({
                        "textDocument": {"uri": uri},
                        "position": {"line": line, "character": character}
                    }),
                );
                fallback
                    .and_then(|value| proof_state_from_plain_goal(&value))
                    .map_err(|fallback_error| {
                        ServiceError::new(
                            "lean-protocol",
                            "Lean could not provide a proof state at this position.",
                            "Wait for the file to finish processing, then move the cursor again.",
                            Some(format!(
                                "interactive RPC: {}; plain goal: {}",
                                service_error_detail(&interactive_error),
                                service_error_detail(&fallback_error)
                            )),
                        )
                    })
            }
        }
    }
}

fn select_toolchain(required_toolchain: Option<&str>) -> ServiceResult<String> {
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

fn server_arguments(root: &Path, toolchain: &str) -> Vec<String> {
    let mut arguments = vec!["run".to_owned(), toolchain.to_owned()];
    if root.join("lakefile.toml").is_file() || root.join("lakefile.lean").is_file() {
        arguments.extend(["lake", "env", "lean", "--server"].map(str::to_owned));
    } else {
        arguments.extend(["lean", "--server"].map(str::to_owned));
    }
    arguments
}

fn spawn_stdout_reader(
    stdout: std::process::ChildStdout,
    writer: Arc<Mutex<BufWriter<ChildStdin>>>,
    pending: PendingRequests,
    diagnostics: Arc<Mutex<HashMap<String, Vec<Value>>>>,
    status: Arc<Mutex<ServerStatus>>,
    log: Arc<Mutex<VecDeque<String>>>,
    workspace_folders: Value,
) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        while let Ok(message) = read_message(&mut reader) {
            if let Some(id) = message.get("id").and_then(Value::as_u64) {
                let sender = pending
                    .lock()
                    .ok()
                    .and_then(|mut pending| pending.remove(&id));
                if let Some(sender) = sender {
                    let response = match message.get("error") {
                        Some(error) => Err(error.to_string()),
                        None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
                    };
                    let _ = sender.send(response);
                    continue;
                }
            }

            let Some(method) = message.get("method").and_then(Value::as_str) else {
                continue;
            };
            if method == "textDocument/publishDiagnostics" {
                if let (Some(uri), Some(values)) = (
                    message.pointer("/params/uri").and_then(Value::as_str),
                    message
                        .pointer("/params/diagnostics")
                        .and_then(Value::as_array),
                ) {
                    if let Ok(mut all) = diagnostics.lock() {
                        all.insert(uri.to_owned(), values.clone());
                    }
                }
                continue;
            }
            if matches!(method, "window/logMessage" | "window/showMessage") {
                if let Some(message) = message.pointer("/params/message").and_then(Value::as_str) {
                    push_log_line(&log, message.to_owned());
                }
                continue;
            }

            if let Some(id) = message.get("id").cloned() {
                let result =
                    server_request_result(method, message.get("params"), &workspace_folders);
                if let Ok(mut writer) = writer.lock() {
                    let _ = write_message(
                        &mut *writer,
                        &json!({"jsonrpc": "2.0", "id": id, "result": result}),
                    );
                }
            }
        }

        if let Ok(mut status) = status.lock() {
            if status.state != "offline" {
                status.state = "error".to_owned();
                status.message = "Lean server stopped unexpectedly".to_owned();
            }
        }
        if let Ok(mut pending) = pending.lock() {
            for (_, sender) in pending.drain() {
                let _ = sender.send(Err("Lean server output closed.".to_owned()));
            }
        }
    });
}

fn spawn_log_reader(stderr: std::process::ChildStderr, log: Arc<Mutex<VecDeque<String>>>) {
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            push_log_line(&log, line);
        }
    });
}

fn push_log_line(log: &Arc<Mutex<VecDeque<String>>>, line: String) {
    if let Ok(mut lines) = log.lock() {
        if lines.len() == MAX_LOG_LINES {
            lines.pop_front();
        }
        lines.push_back(line);
    }
}

fn server_request_result(method: &str, params: Option<&Value>, workspace_folders: &Value) -> Value {
    match method {
        "workspace/configuration" => {
            let count = params
                .and_then(|params| params.get("items"))
                .and_then(Value::as_array)
                .map_or(0, Vec::len);
            Value::Array((0..count).map(|_| json!({})).collect())
        }
        "workspace/workspaceFolders" => workspace_folders.clone(),
        "workspace/applyEdit" => json!({"applied": false}),
        "client/registerCapability"
        | "client/unregisterCapability"
        | "window/workDoneProgress/create" => Value::Null,
        _ => Value::Null,
    }
}

fn detected_capabilities(initialize_result: &Value) -> Vec<String> {
    let capabilities = initialize_result.get("capabilities");
    let mut detected = vec!["diagnostics".to_owned(), "proofState".to_owned()];
    for (key, label) in [
        ("hoverProvider", "hover"),
        ("completionProvider", "completion"),
        ("definitionProvider", "definition"),
        ("referencesProvider", "references"),
        ("documentSymbolProvider", "documentSymbols"),
    ] {
        if capabilities
            .and_then(|value| value.get(key))
            .is_some_and(|value| value != false)
        {
            detected.push(label.to_owned());
        }
    }
    detected
}

fn directory_uri(path: &Path) -> ServiceResult<String> {
    Url::from_directory_path(path)
        .map(String::from)
        .map_err(|()| unsupported_path_error(path))
}

fn file_uri(path: &Path) -> ServiceResult<String> {
    Url::from_file_path(path)
        .map(String::from)
        .map_err(|()| unsupported_path_error(path))
}

fn project_name(root: &Path) -> String {
    root.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Lean project")
        .to_owned()
}

fn toolchain_version(toolchain: &str) -> Option<String> {
    toolchain
        .rsplit(':')
        .next()
        .filter(|version| version.starts_with('v'))
        .map(|version| version.trim_start_matches('v').to_owned())
}

fn process_pipe_error(pipe: &str) -> ServiceError {
    ServiceError::new(
        "lean-server",
        format!("The Lean server did not expose its {pipe} stream."),
        "Restart LeanLander and try opening the project again.",
        None,
    )
}

fn process_error(operation: &str, error: io::Error) -> ServiceError {
    ServiceError::new(
        "lean-server",
        format!("Could not {operation} the Lean server process."),
        "Restart LeanLander and try again.",
        Some(error.to_string()),
    )
}

fn debug_detail(error: &str, stderr: &str) -> String {
    if stderr.is_empty() {
        error.to_owned()
    } else {
        format!("{error}\nLean server stderr:\n{stderr}")
    }
}

fn service_error_detail(error: &ServiceError) -> &str {
    error.debug.as_deref().unwrap_or(&error.summary)
}

fn unsupported_path_error(path: &Path) -> ServiceError {
    ServiceError::new(
        "unsupported-path",
        "The project path could not be represented as a file URI.",
        "Move the project to a local filesystem path and try again.",
        Some(path.display().to_string()),
    )
}

fn server_lock_error<T>(error: std::sync::PoisonError<T>) -> ServiceError {
    ServiceError::new(
        "internal",
        "Lean server state is unavailable.",
        "Restart LeanLander and try again.",
        Some(error.to_string()),
    )
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hypothesis {
    pub name: String,
    pub r#type: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofState {
    pub declaration: String,
    pub goal_count: usize,
    pub hypotheses: Vec<Hypothesis>,
    pub target: Option<String>,
}

impl ProofState {
    fn empty() -> Self {
        Self {
            declaration: "No active declaration".to_owned(),
            goal_count: 0,
            hypotheses: Vec::new(),
            target: None,
        }
    }
}

fn write_message(writer: &mut impl Write, message: &Value) -> io::Result<()> {
    let body = serde_json::to_vec(message)?;
    write!(writer, "Content-Length: {}\r\n\r\n", body.len())?;
    writer.write_all(&body)?;
    writer.flush()
}

fn read_message(reader: &mut impl BufRead) -> io::Result<Value> {
    let mut content_length = None;

    loop {
        let mut header = String::new();
        if reader.read_line(&mut header)? == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "Lean server closed its output stream",
            ));
        }

        if header == "\r\n" || header == "\n" {
            break;
        }

        if let Some((name, value)) = header.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                content_length = Some(
                    value
                        .trim()
                        .parse::<usize>()
                        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?,
                );
            }
        }
    }

    let length = content_length.ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidData, "missing Content-Length header")
    })?;
    if length > MAX_MESSAGE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Lean server message exceeded the 64 MiB limit",
        ));
    }
    let mut body = vec![0; length];
    reader.read_exact(&mut body)?;
    serde_json::from_slice(&body).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

fn proof_state_from_rpc(value: &Value) -> ServiceResult<ProofState> {
    if value.is_null() {
        return Ok(ProofState::empty());
    }

    let goals = value
        .get("goals")
        .and_then(Value::as_array)
        .ok_or_else(|| protocol_error("Interactive goals did not contain a goals array."))?;
    let Some(goal) = goals.first() else {
        return Ok(ProofState::empty());
    };
    let target = goal
        .get("type")
        .map(flatten_tagged_text)
        .filter(|text| !text.is_empty());
    let declaration = goal
        .get("userName?")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
        .map(|name| format!("case {name}"))
        .unwrap_or_else(|| "Active proof".to_owned());
    let hypotheses = goal
        .get("hyps")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|hypothesis| {
            let r#type = hypothesis
                .get("type")
                .map(flatten_tagged_text)
                .unwrap_or_default();
            hypothesis
                .get("names")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(move |name| Hypothesis {
                    name: name.to_owned(),
                    r#type: r#type.clone(),
                })
        })
        .collect();

    Ok(ProofState {
        declaration,
        goal_count: goals.len(),
        hypotheses,
        target,
    })
}

fn proof_state_from_plain_goal(value: &Value) -> ServiceResult<ProofState> {
    if value.is_null() {
        return Ok(ProofState::empty());
    }

    let goal = value
        .get("goal")
        .and_then(Value::as_str)
        .ok_or_else(|| protocol_error("Plain goal response did not contain goal text."))?;
    let lines = goal
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    let declaration = lines
        .first()
        .filter(|line| line.starts_with("case "))
        .map_or_else(|| "Active proof".to_owned(), |line| (*line).to_owned());
    let target = lines
        .iter()
        .rev()
        .find_map(|line| line.strip_prefix('⊢').map(str::trim))
        .filter(|target| !target.is_empty())
        .map(str::to_owned);
    let hypotheses = lines
        .iter()
        .filter(|line| !line.starts_with("case ") && !line.starts_with('⊢'))
        .filter_map(|line| line.split_once(" : "))
        .flat_map(|(names, r#type)| {
            names.split_whitespace().map(move |name| Hypothesis {
                name: name.to_owned(),
                r#type: r#type.to_owned(),
            })
        })
        .collect();

    Ok(ProofState {
        declaration,
        goal_count: usize::from(target.is_some()),
        hypotheses,
        target,
    })
}

fn flatten_tagged_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(values) => values.iter().map(flatten_tagged_text).collect(),
        Value::Object(object) => {
            if let Some(text) = object.get("text").and_then(Value::as_str) {
                return text.to_owned();
            }
            if let Some(append) = object.get("append") {
                return flatten_tagged_text(append);
            }
            if let Some(tag) = object.get("tag") {
                return match tag {
                    Value::Array(parts) => {
                        parts.last().map(flatten_tagged_text).unwrap_or_default()
                    }
                    Value::Object(parts) => parts
                        .get("contents")
                        .or_else(|| parts.get("value"))
                        .map(flatten_tagged_text)
                        .unwrap_or_default(),
                    _ => String::new(),
                };
            }
            String::new()
        }
        _ => String::new(),
    }
}

fn protocol_error(detail: &str) -> ServiceError {
    ServiceError::new(
        "lean-protocol",
        "Lean returned an unsupported language-server response.",
        "Restart the Lean server. If the problem continues, check the project toolchain version.",
        Some(detail.to_owned()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{
        fs,
        io::{BufReader, Cursor},
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn frames_and_reads_json_rpc_messages() {
        let message = json!({"jsonrpc": "2.0", "id": 7, "method": "initialize"});
        let mut bytes = Vec::new();

        write_message(&mut bytes, &message).unwrap();
        let decoded = read_message(&mut BufReader::new(Cursor::new(bytes))).unwrap();

        assert_eq!(decoded, message);
    }

    #[test]
    fn adapts_interactive_goals_and_strips_rpc_tags() {
        let response = json!({
            "goals": [{
                "userName?": "succ",
                "hyps": [{
                    "names": ["n", "ih"],
                    "type": {"append": [
                        {"text": "Nat"},
                        {"tag": [{"info": {"p": 1}}, {"text": " → Nat"}]}
                    ]}
                }],
                "type": {"tag": [{"info": {"p": 2}}, {"text": "n + 0 = n"}]}
            }, {
                "hyps": [],
                "type": "False"
            }]
        });

        assert_eq!(
            proof_state_from_rpc(&response).unwrap(),
            ProofState {
                declaration: "case succ".to_owned(),
                goal_count: 2,
                hypotheses: vec![
                    Hypothesis {
                        name: "n".to_owned(),
                        r#type: "Nat → Nat".to_owned(),
                    },
                    Hypothesis {
                        name: "ih".to_owned(),
                        r#type: "Nat → Nat".to_owned(),
                    },
                ],
                target: Some("n + 0 = n".to_owned()),
            }
        );
    }

    #[test]
    fn adapts_missing_and_empty_goal_responses() {
        assert_eq!(
            proof_state_from_rpc(&Value::Null).unwrap(),
            ProofState::empty()
        );
        assert_eq!(
            proof_state_from_rpc(&json!({"goals": []})).unwrap(),
            ProofState::empty()
        );
    }

    #[test]
    fn adapts_plain_goal_fallback() {
        let response = json!({"goal": "case intro\np : Prop\nh : p\n⊢ p"});

        assert_eq!(
            proof_state_from_plain_goal(&response).unwrap(),
            ProofState {
                declaration: "case intro".to_owned(),
                goal_count: 1,
                hypotheses: vec![
                    Hypothesis {
                        name: "p".to_owned(),
                        r#type: "Prop".to_owned(),
                    },
                    Hypothesis {
                        name: "h".to_owned(),
                        r#type: "p".to_owned(),
                    },
                ],
                target: Some("p".to_owned()),
            }
        );
    }

    #[test]
    fn detects_server_capabilities() {
        assert_eq!(
            detected_capabilities(&json!({
                "capabilities": {
                    "hoverProvider": true,
                    "completionProvider": {},
                    "definitionProvider": false,
                    "referencesProvider": true,
                    "documentSymbolProvider": true
                }
            })),
            vec![
                "diagnostics",
                "proofState",
                "hover",
                "completion",
                "references",
                "documentSymbols",
            ]
        );
    }

    #[test]
    fn builds_lake_and_standalone_server_arguments() {
        let root = temporary_directory("arguments");
        fs::write(root.join("lakefile.toml"), "name = \"fixture\"").unwrap();
        assert_eq!(
            server_arguments(&root, "leanprover/lean4:v4.14.0"),
            [
                "run",
                "leanprover/lean4:v4.14.0",
                "lake",
                "env",
                "lean",
                "--server",
            ]
        );
        fs::remove_file(root.join("lakefile.toml")).unwrap();
        assert_eq!(
            server_arguments(&root, "leanprover/lean4:v4.14.0"),
            ["run", "leanprover/lean4:v4.14.0", "lean", "--server"]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "requires LEANLANDER_LSP_TOOLCHAIN and a locally installed Lean toolchain"]
    fn exchanges_a_proof_request_with_a_real_lean_server() {
        let toolchain = std::env::var("LEANLANDER_LSP_TOOLCHAIN").unwrap();
        let root = temporary_directory("live server");
        let source = "theorem identity (p : Prop) (h : p) : p := by\n  exact h\n";
        fs::write(root.join("Main.lean"), source).unwrap();
        let manager = ServerManager::default();

        let status = manager.start(&root, Some(&toolchain)).unwrap();
        assert_eq!(status.state, "ready");
        manager
            .sync_document(&root, Path::new("Main.lean"), source, 1)
            .unwrap();
        let (_, source_path) = resolve_project_file(&root, Path::new("Main.lean")).unwrap();
        let connection = manager.connection(&root.canonicalize().unwrap()).unwrap();
        let response = connection
            .interactive_goals(&file_uri(&source_path).unwrap(), 1, 2)
            .unwrap();
        println!("interactive goals: {response:#}");
        let proof = proof_state_from_rpc(&response).unwrap();

        assert_eq!(proof.target.as_deref(), Some("p"));
        assert!(proof
            .hypotheses
            .iter()
            .any(|hypothesis| hypothesis.name == "h"));
        for feature in [
            LanguageFeature::Hover,
            LanguageFeature::Completion,
            LanguageFeature::Definition,
            LanguageFeature::References,
            LanguageFeature::DocumentSymbols,
        ] {
            manager
                .request_language_feature(&root, Path::new("Main.lean"), feature, 1, 8)
                .unwrap();
        }
        manager.diagnostics(&root, Path::new("Main.lean")).unwrap();
        manager.stop(&root).unwrap();
        fs::remove_dir_all(root).unwrap();
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
}
