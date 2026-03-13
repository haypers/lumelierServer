//! Shared filename helpers for API handlers (JSON filenames; no path traversal).

/// Only allow [a-zA-Z0-9._-]; reject empty, "..", "/", "\\". Returns None if invalid.
pub fn sanitize_filename(name: &str) -> Option<String> {
    if name.is_empty() || name.contains("..") || name.contains('/') || name.contains('\\') {
        return None;
    }
    let ok = name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-');
    if !ok {
        return None;
    }
    Some(name.to_string())
}

/// Ensure the name ends with .json for storage; if not, append it.
pub fn ensure_json_ext(name: &str) -> String {
    if name.ends_with(".json") {
        name.to_string()
    } else {
        format!("{}.json", name)
    }
}
