use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use serde_json::json;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::{middleware::AppState, models::NimModel};

type ModelCache = Arc<RwLock<(Vec<NimModel>, std::time::Instant)>>;

pub fn router() -> Router<AppState> {
    let cache: ModelCache = Arc::new(RwLock::new((Vec::new(), std::time::Instant::now() - std::time::Duration::from_secs(400))));

    Router::new()
        .route("/models", get(move |state| list_models(state, cache.clone())))
}

async fn list_models(
    State(state): State<AppState>,
    cache: ModelCache,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let now = std::time::Instant::now();
    let cache_duration = std::time::Duration::from_secs(300);

    {
        let read = cache.read().await;
        if !read.0.is_empty() && now.duration_since(read.1) < cache_duration {
            return Ok(Json(json!({ "models": read.0.clone() })));
        }
    }

    let client = reqwest::Client::new();
    let res = client
        .get(format!("{}/models", state.config.nim_base_url))
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch models: {}", e);
            StatusCode::BAD_GATEWAY
        })?;

    if !res.status().is_success() {
        tracing::error!("NIM models endpoint returned status: {}", res.status());
        return Err(StatusCode::BAD_GATEWAY);
    }

    let data: serde_json::Value = res.json().await.map_err(|e| {
        tracing::error!("Failed to parse models response: {}", e);
        StatusCode::BAD_GATEWAY
    })?;

    let models: Vec<NimModel> = data["data"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|m| {
            let id = m["id"].as_str()?.to_string();
            if id.contains("instruct") || id.contains("chat") || id.contains("nemotron") {
                Some(NimModel {
                    id,
                    object: m["object"].as_str()?.to_string(),
                    created: m["created"].as_i64()?,
                    owned_by: m["owned_by"].as_str()?.to_string(),
                })
            } else {
                None
            }
        })
        .collect();

    {
        let mut write = cache.write().await;
        *write = (models.clone(), now);
    }

    Ok(Json(json!({ "models": models })))
}
