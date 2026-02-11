/// Validates that body is UTF-8, valid JSON, and has the shape expected for a broadcast timeline
/// (object with "items" array). Returns Ok(()) or Err(message).
pub fn validate_broadcast_timeline(body: &[u8]) -> Result<(), String> {
    let s = std::str::from_utf8(body).map_err(|e| format!("Invalid UTF-8: {}", e))?;
    let v: serde_json::Value =
        serde_json::from_str(s).map_err(|e| format!("Invalid JSON: {}", e))?;
    let obj = v
        .as_object()
        .ok_or_else(|| "Root must be a JSON object".to_string())?;
    let items = obj
        .get("items")
        .ok_or_else(|| "Missing 'items' field".to_string())?;
    if !items.is_array() {
        return Err("'items' must be an array".to_string());
    }
    for (i, item) in items.as_array().unwrap().iter().enumerate() {
        let o = item
            .as_object()
            .ok_or_else(|| format!("items[{}] must be an object", i))?;
        if let Some(start) = o.get("startSec") {
            if !start.is_number() {
                return Err(format!("items[{}].startSec must be a number", i));
            }
        }
    }
    Ok(())
}
