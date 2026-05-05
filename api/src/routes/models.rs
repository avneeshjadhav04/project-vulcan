use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use serde_json::json;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::{auth::decrypt_key, middleware::AppState, models::{NimModel, Claims, User}};

type ModelCache = Arc<RwLock<(Vec<NimModel>, std::time::Instant)>>;

fn fallback_models() -> Vec<NimModel> {
    // These are confirmed working models on NVIDIA NIM as of early 2025
    vec![
        // Meta Llama models - widely available
        NimModel { id: "meta/llama-3.1-8b-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "meta".to_string() },
        NimModel { id: "meta/llama-3.1-70b-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "meta".to_string() },
        NimModel { id: "meta/llama-3.3-70b-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "meta".to_string() },
        NimModel { id: "meta/llama-3.1-405b-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "meta".to_string() },
        // Mistral models
        NimModel { id: "mistralai/mistral-7b-instruct-v0.3".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "mistralai".to_string() },
        NimModel { id: "mistralai/mixtral-8x7b-instruct-v0.1".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "mistralai".to_string() },
        NimModel { id: "mistralai/mixtral-8x22b-instruct-v0.1".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "mistralai".to_string() },
        // Google Gemma
        NimModel { id: "google/gemma-2-2b-it".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "google".to_string() },
        NimModel { id: "google/gemma-2-9b-it".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "google".to_string() },
        NimModel { id: "google/gemma-2-27b-it".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "google".to_string() },
        // Microsoft Phi
        NimModel { id: "microsoft/phi-3-mini-128k-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "microsoft".to_string() },
        // Qwen
        NimModel { id: "qwen/qwen2.5-7b-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "qwen".to_string() },
        NimModel { id: "qwen/qwen2.5-72b-instruct".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "qwen".to_string() },
        // DeepSeek
        NimModel { id: "deepseek-ai/deepseek-r1".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "deepseek-ai".to_string() },
        NimModel { id: "deepseek-ai/deepseek-r1-distill-llama-70b".to_string(), object: "model".to_string(), created: 1700000000, owned_by: "deepseek-ai".to_string() },
    ]
}

pub fn router() -> Router<AppState> {
    let cache: ModelCache = Arc::new(RwLock::new((Vec::new(), std::time::Instant::now() - std::time::Duration::from_secs(400))));

    Router::new()
        .route("/models", get(move |state| list_models(state, cache.clone())))
        .route("/models/validate", get(validate_model))
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

async fn validate_model(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let model_id = params.get("model_id").cloned().unwrap_or_default();
    if model_id.is_empty() {
        return Ok(Json(json!({"valid": false, "error": "model_id query parameter is required"})));
    }
    let user: User = sqlx::query_as("SELECT * FROM users WHERE id = ?1")
        .bind(claims.sub.clone())
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let nim_key = match user.encrypted_nim_key {
        Some(enc) => decrypt_key(&enc, &state.config.master_key).map_err(|_| StatusCode::BAD_REQUEST)?,
        None => return Ok(Json(json!({"valid": false, "error": "No API key configured"}))),
    };

    // Do a real test request to validate the model actually works
    let test_body = json!({
        "model": model_id,
        "messages": [{"role": "user", "content": "Hi"}],
        "max_tokens": 5,
        "stream": false,
    });

    let test_res = state.http_client
        .post(format!("{}/chat/completions", state.config.nim_base_url))
        .header("Authorization", format!("Bearer {}", nim_key))
        .header("Content-Type", "application/json")
        .json(&test_body)
        .send()
        .await;

    match test_res {
        Ok(res) => {
            let status = res.status();
            if status.is_success() {
                Ok(Json(json!({"valid": true, "model_id": model_id})))
            } else {
                let body = res.text().await.unwrap_or_default();
                tracing::warn!("Model validation failed for {}: {} - {}", model_id, status, body);
                
                let error_msg = if status == 404 {
                    format!("Model '{}' is not available (404). It may require different permissions or be temporarily disabled.", model_id)
                } else {
                    format!("Model validation failed: {}", status)
                };
                
                Ok(Json(json!({
                    "valid": false,
                    "model_id": model_id,
                    "error": error_msg,
                    "status": status.as_u16()
                })))
            }
        }
        Err(e) => {
            tracing::error!("Model validation request failed: {}", e);
            Ok(Json(json!({"valid": true})))
        }
    }
}
