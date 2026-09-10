use super::{ServiceError, ServiceResult};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_SOURCE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_SEARCH_RESULTS: usize = 500;
const MAX_RECENT_PROJECTS: usize = 10;
const RECENT_PROJECTS_FILE: &str = "recent-projects.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    pub id: String,
    pub name: String,
    pub path: String,
    pub content: String,
    pub loaded: bool,
    pub read_only: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTreeNode {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub children: Vec<ProjectTreeNode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSearchResult {
    pub path: String,
    pub line: usize,
    pub preview: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMetadata {
    pub name: String,
    pub path: String,
    pub lean_toolchain: Option<String>,
    pub lakefile: Option<String>,
    pub source_roots: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredProject {
    pub metadata: ProjectMetadata,
    pub files: Vec<ProjectFile>,
    pub tree: Vec<ProjectTreeNode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub name: String,
    pub path: String,
    pub opened_at: u64,
}

pub fn discover_project(path: &Path) -> ServiceResult<DiscoveredProject> {
    let root = canonical_project_root(path)?;
    let root_display = path_to_string(&root)?;
    let name = root
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(&root_display)
        .to_owned();
    let mut warnings = Vec::new();
    let lean_toolchain = read_optional_marker(&root.join("lean-toolchain"), &mut warnings)?;
    let lakefile = detect_lakefile(&root, &mut warnings);
    let mut source_paths = Vec::new();

    collect_lean_sources(&root, &root, &mut source_paths, &mut warnings)?;
    source_paths.sort();

    if source_paths.is_empty() {
        warnings.push("No Lean source files were found.".to_owned());
    }

    if lean_toolchain.is_none() {
        warnings.push("No lean-toolchain file was found.".to_owned());
    }

    let mut source_roots = BTreeSet::new();
    let mut files = Vec::with_capacity(source_paths.len());

    for source_path in source_paths {
        let relative = source_path.strip_prefix(&root).map_err(|error| {
            ServiceError::new(
                "filesystem",
                "Could not resolve a Lean source path.",
                "Reopen the project and try again.",
                Some(error.to_string()),
            )
        })?;
        let relative_display = relative_path_to_string(relative)?;
        let source_root = relative
            .parent()
            .and_then(|parent| parent.components().next())
            .and_then(|component| component.as_os_str().to_str())
            .unwrap_or(".")
            .to_owned();
        source_roots.insert(source_root);

        files.push(ProjectFile {
            id: relative_display.clone(),
            name: source_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(&relative_display)
                .to_owned(),
            path: relative_display,
            content: String::new(),
            loaded: false,
            read_only: false,
        });
    }

    let tree = project_tree(&files);
    Ok(DiscoveredProject {
        metadata: ProjectMetadata {
            name,
            path: root_display,
            lean_toolchain,
            lakefile,
            source_roots: source_roots.into_iter().collect(),
            warnings,
        },
        files,
        tree,
    })
}

pub fn load_project_file(project_path: &Path, relative_path: &Path) -> ServiceResult<ProjectFile> {
    let (root, source_path) = resolve_project_file(project_path, relative_path)?;
    let relative = source_path.strip_prefix(&root).map_err(|error| {
        ServiceError::new(
            "filesystem",
            "Could not resolve the Lean source path.",
            "Reopen the project and try again.",
            Some(error.to_string()),
        )
    })?;
    let display_path = relative_path_to_string(relative)?;

    Ok(ProjectFile {
        id: display_path.clone(),
        name: source_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(&display_path)
            .to_owned(),
        path: display_path,
        content: read_source_file(&source_path)?,
        loaded: true,
        read_only: false,
    })
}

pub fn load_project_uri(project_path: &Path, uri: &str) -> ServiceResult<ProjectFile> {
    let root = canonical_project_root(project_path)?;
    let source_path = url::Url::parse(uri)
        .ok()
        .and_then(|uri| uri.to_file_path().ok())
        .ok_or_else(|| invalid_source_uri(uri))?
        .canonicalize()
        .map_err(|error| {
            ServiceError::io("resolve the Lean source file", Path::new(uri), &error)
        })?;
    let dependency_root = root.join(".lake/packages").canonicalize().ok();
    let read_only = dependency_root
        .as_ref()
        .is_some_and(|dependency_root| source_path.starts_with(dependency_root));
    if !source_path.starts_with(&root)
        || (!read_only
            && source_path
                .components()
                .any(|part| part.as_os_str() == ".lake"))
    {
        return Err(invalid_source_uri(uri));
    }
    let relative = source_path
        .strip_prefix(&root)
        .map_err(|_| invalid_source_uri(uri))?;
    validate_relative_lean_path(relative)?;
    let display_path = relative_path_to_string(relative)?;
    Ok(ProjectFile {
        id: display_path.clone(),
        name: source_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(&display_path)
            .to_owned(),
        path: display_path,
        content: read_source_file(&source_path)?,
        loaded: true,
        read_only,
    })
}

pub fn search_project(project_path: &Path, query: &str) -> ServiceResult<Vec<ProjectSearchResult>> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let root = canonical_project_root(project_path)?;
    let mut sources = Vec::new();
    let mut warnings = Vec::new();
    collect_lean_sources(&root, &root, &mut sources, &mut warnings)?;
    let mut results = Vec::new();
    for source in sources {
        let Ok(content) = read_source_file(&source) else {
            continue;
        };
        for (index, line) in content.lines().enumerate() {
            if line.contains(query) {
                results.push(ProjectSearchResult {
                    path: relative_path_to_string(
                        source
                            .strip_prefix(&root)
                            .map_err(|_| invalid_source_uri(query))?,
                    )?,
                    line: index + 1,
                    preview: line.trim().to_owned(),
                });
                if results.len() == MAX_SEARCH_RESULTS {
                    return Ok(results);
                }
            }
        }
    }
    Ok(results)
}

fn project_tree(files: &[ProjectFile]) -> Vec<ProjectTreeNode> {
    fn insert(
        nodes: &mut BTreeMap<String, ProjectTreeNode>,
        parts: &[&str],
        full_path: &str,
        parent_path: &str,
    ) {
        let Some((name, rest)) = parts.split_first() else {
            return;
        };
        let node = nodes
            .entry((*name).to_owned())
            .or_insert_with(|| ProjectTreeNode {
                name: (*name).to_owned(),
                path: if rest.is_empty() {
                    full_path.to_owned()
                } else if parent_path.is_empty() {
                    (*name).to_owned()
                } else {
                    format!("{parent_path}/{name}")
                },
                kind: if rest.is_empty() { "file" } else { "directory" }.to_owned(),
                children: Vec::new(),
            });
        if !rest.is_empty() {
            let mut children = node
                .children
                .drain(..)
                .map(|child| (child.name.clone(), child))
                .collect();
            insert(&mut children, rest, full_path, &node.path);
            node.children = children.into_values().collect();
        }
    }
    let mut roots = BTreeMap::new();
    for file in files {
        insert(
            &mut roots,
            &file.path.split('/').collect::<Vec<_>>(),
            &file.path,
            "",
        );
    }
    roots.into_values().collect()
}

fn invalid_source_uri(uri: &str) -> ServiceError {
    ServiceError::new(
        "invalid-path",
        "The language server target is outside the project and dependency roots.",
        "Open a Lean source inside the project or .lake/packages.",
        Some(uri.to_owned()),
    )
}

pub fn save_project_file(
    project_path: &Path,
    relative_path: &Path,
    content: &str,
) -> ServiceResult<()> {
    let (_, source_path) = resolve_project_file(project_path, relative_path)?;

    fs::write(&source_path, content)
        .map_err(|error| ServiceError::io("save the Lean source file", &source_path, &error))
}

pub fn load_recent_projects(data_dir: &Path) -> ServiceResult<Vec<RecentProject>> {
    let path = data_dir.join(RECENT_PROJECTS_FILE);

    if !path.exists() {
        return Ok(Vec::new());
    }

    let contents = fs::read_to_string(&path)
        .map_err(|error| ServiceError::io("read recent projects", &path, &error))?;
    serde_json::from_str(&contents).map_err(|error| {
        ServiceError::new(
            "configuration",
            "Recent project history is malformed.",
            "Remove recent-projects.json from the LeanLander application data directory.",
            Some(error.to_string()),
        )
    })
}

pub fn remember_project(data_dir: &Path, project: &ProjectMetadata) -> ServiceResult<()> {
    let mut recent_projects = load_recent_projects(data_dir)?;
    recent_projects.retain(|recent| recent.path != project.path);
    recent_projects.insert(
        0,
        RecentProject {
            name: project.name.clone(),
            path: project.path.clone(),
            opened_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        },
    );
    recent_projects.truncate(MAX_RECENT_PROJECTS);

    fs::create_dir_all(data_dir).map_err(|error| {
        ServiceError::io("create the application data directory", data_dir, &error)
    })?;
    let path = data_dir.join(RECENT_PROJECTS_FILE);
    let contents = serde_json::to_vec_pretty(&recent_projects).map_err(|error| {
        ServiceError::new(
            "configuration",
            "Could not encode recent project history.",
            "Try opening the project again.",
            Some(error.to_string()),
        )
    })?;

    fs::write(&path, contents)
        .map_err(|error| ServiceError::io("save recent projects", &path, &error))
}

pub(crate) fn canonical_project_root(path: &Path) -> ServiceResult<PathBuf> {
    let canonical = path
        .canonicalize()
        .map_err(|error| ServiceError::io("open the project directory", path, &error))?;

    if !canonical.is_dir() {
        return Err(ServiceError::new(
            "invalid-project",
            "The selected path is not a directory.",
            "Choose a Lean project directory.",
            Some(canonical.display().to_string()),
        ));
    }

    Ok(canonical)
}

fn collect_lean_sources(
    root: &Path,
    directory: &Path,
    sources: &mut Vec<PathBuf>,
    warnings: &mut Vec<String>,
) -> ServiceResult<()> {
    let entries = fs::read_dir(directory)
        .map_err(|error| ServiceError::io("read the project directory", directory, &error))?;
    let mut entries = entries.collect::<Result<Vec<_>, _>>().map_err(|error| {
        ServiceError::io("read an entry in the project directory", directory, &error)
    })?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| ServiceError::io("inspect a project entry", &path, &error))?;

        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            if is_ignored_directory(&entry.file_name()) {
                continue;
            }
            collect_lean_sources(root, &path, sources, warnings)?;
        } else if file_type.is_file()
            && path
                .extension()
                .is_some_and(|extension| extension == "lean")
        {
            sources.push(path);
        }
    }

    if !directory.starts_with(root) {
        return Err(ServiceError::new(
            "invalid-path",
            "Project discovery left the selected directory.",
            "Remove symlinks that point outside the project.",
            Some(directory.display().to_string()),
        ));
    }

    Ok(())
}

fn is_ignored_directory(name: &std::ffi::OsStr) -> bool {
    matches!(
        name.to_str(),
        Some(".git" | ".lake" | "build" | "node_modules" | "target")
    )
}

fn read_source_file(path: &Path) -> ServiceResult<String> {
    let metadata = fs::metadata(path)
        .map_err(|error| ServiceError::io("inspect the Lean source file", path, &error))?;

    if metadata.len() > MAX_SOURCE_BYTES {
        return Err(ServiceError::new(
            "file-too-large",
            "The Lean source file is larger than 2 MiB.",
            "Open a smaller source file or split the module.",
            Some(path.display().to_string()),
        ));
    }

    fs::read_to_string(path)
        .map_err(|error| ServiceError::io("read the Lean source file as UTF-8", path, &error))
}

pub(crate) fn resolve_project_file(
    project_path: &Path,
    relative_path: &Path,
) -> ServiceResult<(PathBuf, PathBuf)> {
    validate_relative_lean_path(relative_path)?;
    let root = canonical_project_root(project_path)?;
    let candidate = root.join(relative_path);
    let metadata = fs::symlink_metadata(&candidate)
        .map_err(|error| ServiceError::io("inspect the Lean source file", &candidate, &error))?;

    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(ServiceError::new(
            "invalid-path",
            "The selected source is not a regular project file.",
            "Choose an existing .lean file inside the project.",
            Some(candidate.display().to_string()),
        ));
    }

    let canonical = candidate
        .canonicalize()
        .map_err(|error| ServiceError::io("resolve the Lean source file", &candidate, &error))?;
    if !canonical.starts_with(&root) {
        return Err(ServiceError::new(
            "invalid-path",
            "The selected source is outside the project directory.",
            "Choose a .lean file inside the project.",
            Some(canonical.display().to_string()),
        ));
    }

    Ok((root, canonical))
}

fn validate_relative_lean_path(path: &Path) -> ServiceResult<()> {
    let valid_components = !path.as_os_str().is_empty()
        && !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)));
    let is_lean_source = path
        .extension()
        .is_some_and(|extension| extension == "lean");

    if !valid_components || !is_lean_source {
        return Err(ServiceError::new(
            "invalid-path",
            "The source path must be a relative .lean file inside the project.",
            "Choose a Lean source from the project tree.",
            Some(path.display().to_string()),
        ));
    }

    Ok(())
}

fn read_optional_marker(path: &Path, warnings: &mut Vec<String>) -> ServiceResult<Option<String>> {
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(path)
        .map_err(|error| ServiceError::io("read the lean-toolchain file", path, &error))?;
    let value = content.lines().next().unwrap_or_default().trim();

    if value.is_empty() {
        warnings.push("The lean-toolchain file is empty.".to_owned());
        return Ok(None);
    }

    Ok(Some(value.to_owned()))
}

fn detect_lakefile(root: &Path, warnings: &mut Vec<String>) -> Option<String> {
    let has_toml = root.join("lakefile.toml").is_file();
    let has_lean = root.join("lakefile.lean").is_file();

    if has_toml && has_lean {
        warnings.push("Both lakefile.toml and lakefile.lean are present.".to_owned());
    }

    if has_toml {
        Some("lakefile.toml".to_owned())
    } else if has_lean {
        Some("lakefile.lean".to_owned())
    } else {
        warnings.push("No Lake project file was found.".to_owned());
        None
    }
}

fn path_to_string(path: &Path) -> ServiceResult<String> {
    path.to_str().map(str::to_owned).ok_or_else(|| {
        ServiceError::new(
            "unsupported-path",
            "The project path is not valid Unicode.",
            "Move the project to a path that can be displayed by the operating system.",
            Some(path.display().to_string()),
        )
    })
}

fn relative_path_to_string(path: &Path) -> ServiceResult<String> {
    path.components()
        .map(|component| {
            component.as_os_str().to_str().ok_or_else(|| {
                ServiceError::new(
                    "unsupported-path",
                    "A source path is not valid Unicode.",
                    "Rename the source so LeanLander can display it.",
                    Some(path.display().to_string()),
                )
            })
        })
        .collect::<ServiceResult<Vec<_>>>()
        .map(|components| components.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{env, process, time::SystemTime};

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(name: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = env::temp_dir().join(format!("leanlander-{name}-{}-{nonce}", process::id()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn discovers_unicode_projects_and_skips_build_directories() {
        let directory = TestDirectory::new("Proof Garden 形式化");
        fs::write(
            directory.0.join("lean-toolchain"),
            "leanprover/lean4:v4.19.0\n",
        )
        .unwrap();
        fs::write(directory.0.join("lakefile.toml"), "name = \"Garden\"").unwrap();
        fs::create_dir(directory.0.join("Garden")).unwrap();
        fs::write(
            directory.0.join("Garden/Main.lean"),
            "theorem seed : True := by trivial",
        )
        .unwrap();
        fs::create_dir(directory.0.join(".lake")).unwrap();
        fs::write(directory.0.join(".lake/Ignored.lean"), "bad").unwrap();

        let project = discover_project(&directory.0).unwrap();

        assert_eq!(
            project.metadata.lean_toolchain.as_deref(),
            Some("leanprover/lean4:v4.19.0")
        );
        assert_eq!(project.metadata.lakefile.as_deref(), Some("lakefile.toml"));
        assert_eq!(project.metadata.source_roots, ["Garden"]);
        assert_eq!(project.files.len(), 1);
        assert_eq!(project.files[0].path, "Garden/Main.lean");
    }

    #[test]
    fn saves_an_existing_source_and_rejects_traversal() {
        let directory = TestDirectory::new("save");
        fs::write(directory.0.join("Main.lean"), "def before := 1").unwrap();

        save_project_file(&directory.0, Path::new("Main.lean"), "def after := 2").unwrap();

        assert_eq!(
            load_project_file(&directory.0, Path::new("Main.lean"))
                .unwrap()
                .content,
            "def after := 2"
        );
        assert!(load_project_file(&directory.0, Path::new("../outside.lean")).is_err());
        assert!(save_project_file(&directory.0, Path::new("notes.txt"), "no").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn ignores_symlinks_and_rejects_symlinked_files() {
        use std::os::unix::fs::symlink;

        let directory = TestDirectory::new("symlink");
        let outside = TestDirectory::new("outside");
        fs::write(outside.0.join("Outside.lean"), "def escaped := true").unwrap();
        symlink(&outside.0, directory.0.join("Linked")).unwrap();
        symlink(
            outside.0.join("Outside.lean"),
            directory.0.join("Escape.lean"),
        )
        .unwrap();

        let project = discover_project(&directory.0).unwrap();

        assert!(project.files.is_empty());
        assert!(load_project_file(&directory.0, Path::new("Escape.lean")).is_err());
    }

    #[test]
    fn persists_recent_projects_and_reports_malformed_history() {
        let directory = TestDirectory::new("recent");
        let project = ProjectMetadata {
            name: "Proof Garden".to_owned(),
            path: "/tmp/Proof Garden".to_owned(),
            lean_toolchain: None,
            lakefile: None,
            source_roots: Vec::new(),
            warnings: Vec::new(),
        };

        remember_project(&directory.0, &project).unwrap();
        remember_project(&directory.0, &project).unwrap();

        let recent = load_recent_projects(&directory.0).unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].name, "Proof Garden");

        fs::write(directory.0.join(RECENT_PROJECTS_FILE), "not json").unwrap();
        assert_eq!(
            load_recent_projects(&directory.0).unwrap_err().category,
            "configuration"
        );
    }

    #[test]
    fn returns_a_path_tree_and_searches_source_contents() {
        let directory = TestDirectory::new("tree-search");
        fs::create_dir_all(directory.0.join("Mathlib/Analysis")).unwrap();
        fs::write(
            directory.0.join("Mathlib/Analysis/Main.lean"),
            "theorem searchable_fact : True := by trivial\n",
        )
        .unwrap();

        let project = discover_project(&directory.0).unwrap();
        assert_eq!(project.tree[0].name, "Mathlib");
        assert_eq!(project.tree[0].path, "Mathlib");
        assert_eq!(project.tree[0].children[0].name, "Analysis");
        assert_eq!(project.tree[0].children[0].path, "Mathlib/Analysis");
        assert_eq!(project.tree[0].children[0].children[0].name, "Main.lean");
        assert_eq!(
            project.tree[0].children[0].children[0].path,
            "Mathlib/Analysis/Main.lean"
        );
        assert!(project.files[0].content.is_empty());
        assert!(!project.files[0].loaded);

        let results = search_project(&directory.0, "searchable_fact").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "Mathlib/Analysis/Main.lean");
        assert_eq!(results[0].line, 1);
    }

    #[test]
    fn opens_only_project_and_dependency_uris() {
        let directory = TestDirectory::new("dependency-uri");
        fs::write(directory.0.join("Main.lean"), "import Dep").unwrap();
        fs::create_dir_all(directory.0.join(".lake/packages/dep/Dep")).unwrap();
        let dependency = directory.0.join(".lake/packages/dep/Dep/Main.lean");
        fs::write(&dependency, "theorem from_dependency : True := by trivial").unwrap();
        let outside = TestDirectory::new("outside-uri");
        let outside_source = outside.0.join("Outside.lean");
        fs::write(&outside_source, "theorem outside : True := by trivial").unwrap();

        let project_uri = url::Url::from_file_path(directory.0.join("Main.lean")).unwrap();
        let dependency_uri = url::Url::from_file_path(&dependency).unwrap();
        let outside_uri = url::Url::from_file_path(&outside_source).unwrap();

        assert!(
            !load_project_uri(&directory.0, project_uri.as_str())
                .unwrap()
                .read_only
        );
        assert!(
            load_project_uri(&directory.0, dependency_uri.as_str())
                .unwrap()
                .read_only
        );
        assert!(load_project_uri(&directory.0, outside_uri.as_str()).is_err());
    }
}
