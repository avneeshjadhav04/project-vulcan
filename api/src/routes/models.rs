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

fn fallback_models() -> Vec<NimModel> {
    vec![
        NimModel { id: "nvidia/llama-3.1-nemotron-70b-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "nvidia".to_string() },
        NimModel { id: "nvidia/llama-3.1-nemotron-51b-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "nvidia".to_string() },
        NimModel { id: "nvidia/llama-3.3-nemotron-super-49b-v1".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "nvidia".to_string() },
        NimModel { id: "nvidia/llama-3.1-nemotron-ultra-253b-v1".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "nvidia".to_string() },
        NimModel { id: "meta/llama-3.3-70b-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "meta".to_string() },
        NimModel { id: "meta/llama-3.1-405b-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "meta".to_string() },
        NimModel { id: "meta/llama-3.1-70b-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "meta".to_string() },
        NimModel { id: "meta/llama-3.1-8b-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "meta".to_string() },
        NimModel { id: "meta/llama-3.2-1b-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "meta".to_string() },
        NimModel { id: "meta/llama-3.2-3b-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "meta".to_string() },
        NimModel { id: "meta/llama-3.2-11b-vision-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "meta".to_string() },
        NimModel { id: "meta/llama-3.2-90b-vision-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "meta".to_string() },
        NimModel { id: "mistralai/mistral-large-2-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "mistralai".to_string() },
        NimModel { id: "mistralai/mixtral-8x22b-instruct-v0.1".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "mistralai".to_string() },
        NimModel { id: "mistralai/mixtral-8x7b-instruct-v0.1".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "mistralai".to_string() },
        NimModel { id: "mistralai/mistral-7b-instruct-v0.3".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "mistralai".to_string() },
        NimModel { id: "google/gemma-2-27b-it".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "google".to_string() },
        NimModel { id: "google/gemma-2-9b-it".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "google".to_string() },
        NimModel { id: "google/gemma-2-2b-it".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "google".to_string() },
        NimModel { id: "microsoft/phi-4".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "microsoft".to_string() },
        NimModel { id: "microsoft/phi-3.5-moe-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "microsoft".to_string() },
        NimModel { id: "microsoft/phi-3-mini-128k-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "microsoft".to_string() },
        NimModel { id: "qwen/qwen2.5-72b-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "qwen".to_string() },
        NimModel { id: "qwen/qwen2.5-7b-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "qwen".to_string() },
        NimModel { id: "qwen/qwen2.5-coder-32b-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "qwen".to_string() },
        NimModel { id: "qwen/qwq-32b".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "qwen".to_string() },
        NimModel { id: "deepseek-ai/deepseek-r1".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "deepseek-ai".to_string() },
        NimModel { id: "deepseek-ai/deepseek-r1-distill-llama-70b".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "deepseek-ai".to_string() },
        NimModel { id: "deepseek-ai/deepseek-r1-distill-qwen-32b".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "deepseek-ai".to_string() },
        NimModel { id: "nvidia/cosmos-nemotron-34b".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "nvidia".to_string() },
        NimModel { id: "nvidia/ace-agent-llama-3.2-3b".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "nvidia".to_string() },
        NimModel { id: "nvidia/embed-qa-4".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "nvidia".to_string() },
        NimModel { id: "nvidia/e5-mistral-7b-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "nvidia".to_string() },
        NimModel { id: "nvidia/llama-3.2-nv-embedqa-1b-v2".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "nvidia".to_string() },
        NimModel { id: "nvidia/llama-3.2-nv-rerankqa-1b-v2".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "nvidia".to_string() },
    ]
}

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

    // If we previously cached an error, check error TTL before falling back
    if write.0.is_empty() && now.duration_since(write.1) < error_cache_duration {
        tracing::warn!("Returning fallback models — NIM API was recently unreachable");
        return Ok(Json(json!({ "models": fallback_models() })));
    }

    let res = match state.http_client
        .get(format!("{}/models", state.config.nim_base_url))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("Failed to fetch models: {}", e);
            *write = (Vec::new(), now);
            return Ok(Json(json!({ "models": fallback_models() })));
        }
    };

    if !res.status().is_success() {
        tracing::error!("NIM models endpoint returned status: {}", res.status());
        *write = (Vec::new(), now);
        return Ok(Json(json!({ "models": fallback_models() })));
    }

    let data: serde_json::Value = match res.json().await {
        Ok(d) => d,
        Err(e) => {
            tracing::error!("Failed to parse models response: {}", e);
            *write = (Vec::new(), now);
            return Ok(Json(json!({ "models": fallback_models() })));
        }
    };

    let models: Vec<NimModel> = data["data"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|m| {
            Some(NimModel {
                id: m["id"].as_str()?.to_string(),
                object: m["object"].as_str()?.to_string(),
                created: m["created"].as_i64()?,
                owned_by: m["owned_by"].as_str()?.to_string(),
            })
        })
        .collect();

    let models = if models.is_empty() {
        tracing::warn!("NIM API returned empty model list, using fallback");
        fallback_models()
    } else {
        models
    };

    *write = (models.clone(), now);

    Ok(Json(json!({ "models": models })))
}
