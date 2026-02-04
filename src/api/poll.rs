use axum::Json;
use serde::Serialize;

#[derive(Serialize)]
pub struct PollEvent {
    pub t: i64,
    pub color: String,
}

#[derive(Serialize)]
pub struct PollResponse {
    #[serde(rename = "serverTime")]
    pub server_time: u64,
    pub events: Vec<PollEvent>,
}

pub async fn poll() -> Json<PollResponse> {
    let server_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system time before UNIX_EPOCH")
        .as_millis() as u64;

    let events = vec![PollEvent {
        t: 0,
        color: "#ff0000".to_string(),
    }];

    Json(PollResponse {
        server_time,
        events,
    })
}
