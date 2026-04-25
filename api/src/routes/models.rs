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
    let error_cache_duration = std::time::Duration::from_secs(30);

    {
        let read = cache.read().await;
        if !read.0.is_empty() && now.duration_since(read.1) < cache_duration {
            return Ok(Json(json!({ "models": read.0.clone() })));
        }
    }

    // Only one request refreshes the cache
    let mut write = cache.write().await;

    // Double-check after acquiring write lock
    if !write.0.is_empty() && now.duration_since(write.1) < cache_duration {
        return Ok(Json(json!({ "models": write.0.clone() })));
    }

    // If we previously cached an error, check error TTL
    if write.0.is_empty() && now.duration_since(write.1) < error_cache_duration {
        return Err(StatusCode::BAD_GATEWAY);
    }

    let res = state.http_client
        .get(format!("{}/models", state.config.nim_base_url))
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch models: {}", e);
            *write = (Vec::new(), now);
            StatusCode::BAD_GATEWAY
        })?;

    if !res.status().is_success() {
        tracing::error!("NIM models endpoint returned status: {}", res.status());
        *write = (Vec::new(), now);
        return Err(StatusCode::BAD_GATEWAY);
    }

    let data: serde_json::Value = res.json().await.map_err(|e| {
        tracing::error!("Failed to parse models response: {}", e);
        *write = (Vec::new(), now);
        StatusCode::BAD_GATEWAY
    })?;

    let models: Vec<NimModel> = data["data"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|m| {
            let id = m["id"].as_str()?.to_string();
            let id_lower = id.to_lowercase();
            if id_lower.contains("instruct") || id_lower.contains("chat") || id_lower.contains("nemotron") {
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

    *write = (models.clone(), now);

    Ok(Json(json!({ "models": models })))
}
