pub mod lake;
pub mod project;
pub mod server;
pub mod toolchain;

use serde::Serialize;
use std::fmt;

pub type ServiceResult<T> = Result<T, ServiceError>;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceError {
    pub category: String,
    pub summary: String,
    pub suggestion: String,
    pub debug: Option<String>,
}

impl ServiceError {
    pub fn new(
        category: impl Into<String>,
        summary: impl Into<String>,
        suggestion: impl Into<String>,
        debug: Option<String>,
    ) -> Self {
        Self {
            category: category.into(),
            summary: summary.into(),
            suggestion: suggestion.into(),
            debug,
        }
    }

    pub fn io(operation: &str, path: &std::path::Path, error: &std::io::Error) -> Self {
        Self::new(
            "filesystem",
            format!("Could not {operation}."),
            "Check that the path exists and LeanLander has permission to access it.",
            Some(format!("{}: {error}", path.display())),
        )
    }
}

impl fmt::Display for ServiceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.summary)
    }
}

impl std::error::Error for ServiceError {}
