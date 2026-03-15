//! # Timeline Validator — Broadcast Timeline JSON
//!
//! Validates POST body for broadcast timeline: UTF-8, valid JSON, root object with "items" array;
//! each item must be an object; startSec if present must be a number.
//!
//! This validator will be revisited when the new timeline interpreter (between timeline data and
//! device payload) is built.

/// Parses and validates in one pass. Returns the parsed `Value` on success.
pub fn parse_and_validate_broadcast_timeline(body: &[u8]) -> Result<serde_json::Value, String> {
    let s = std::str::from_utf8(body).map_err(|e| format!("Invalid UTF-8: {}", e))?;
    let v: serde_json::Value =
        serde_json::from_str(s).map_err(|e| format!("Invalid JSON: {}", e))?;
    let obj = v
        .as_object()
        .ok_or_else(|| "Root must be a JSON object".to_string())?;
    let items = obj
        .get("items")
        .ok_or_else(|| "Missing 'items' field".to_string())?;
    let arr = items
        .as_array()
        .ok_or_else(|| "'items' must be an array".to_string())?;
    for (i, item) in arr.iter().enumerate() {
        let o = item
            .as_object()
            .ok_or_else(|| format!("items[{}] must be an object", i))?;
        if let Some(start) = o.get("startSec") {
            if !start.is_number() {
                return Err(format!("items[{}].startSec must be a number", i));
            }
        }
    }
    Ok(v)
}

/// Returns Ok(()) if valid, Err(message) otherwise.
pub fn validate_broadcast_timeline(body: &[u8]) -> Result<(), String> {
    parse_and_validate_broadcast_timeline(body).map(|_| ())
}
