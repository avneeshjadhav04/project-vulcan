use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::{
    auth::decrypt_key,
    middleware::AppState,
    models::{Claims, NimModel, Provider},
    providers::{get_provider_definition, ProviderDefinition},
};

type ModelCache = Arc<RwLock<HashMap<String, (Vec<NimModel>, std::time::Instant)>>>;

fn models_from_fallback(def: &ProviderDefinition) -> Vec<NimModel> {
    def.fallback_models
        .iter()
        .map(|id| NimModel {
            id: id.to_string(),
            object: "model".to_string(),
            created: 1700000000,
            owned_by: def.name.to_string(),
        })
        .collect()
}

pub fn router() -> Router<AppState> {
    let cache: ModelCache = Arc::new(RwLock::new(HashMap::new()));

    Router::new()
        .route("/models", get(move |state, claims| list_models(state, claims, cache.clone())))
        .route("/models/validate", get(validate_model))
}

#[derive(Debug, serde::Serialize)]
struct ProviderModels {
    provider_id: String,
    provider_name: String,
    models: Vec<NimModel>,
}

async fn list_models(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    cache: ModelCache,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let providers: Vec<Provider> = sqlx::query_as(
        "SELECT * FROM providers WHERE user_id = ?1 AND is_active = 1 ORDER BY created_at ASC"
    )
    .bind(&claims.sub)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("List providers for models error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if providers.is_empty() {
        return Ok(Json(json!({ "providers": [] })));
    }

    let mut result = Vec::new();

    for provider in providers {
        let models = fetch_models_for_provider(&state, &provider, &cache).await;
        result.push(ProviderModels {
            provider_id: provider.id.clone(),
            provider_name: provider.name.clone(),
            models,
        });
    }

    Ok(Json(json!({ "providers": result })))
}

async fn fetch_models_for_provider(
    state: &AppState,
    provider: &Provider,
    cache: &ModelCache,
) -> Vec<NimModel> {
    let cache_key = format!("{}:{}", provider.base_url, provider.id);
    let cache_duration = std::time::Duration::from_secs(300);
    let error_cache_duration = std::time::Duration::from_secs(30);
    let now = std::time::Instant::now();

    {
        let read = cache.read().await;
        if let Some((models, timestamp)) = read.get(&cache_key) {
            if !models.is_empty() && now.duration_since(*timestamp) < cache_duration {
                return models.clone();
            }
            if models.is_empty() && now.duration_since(*timestamp) < error_cache_duration {
                return fallback_for_provider(provider);
            }
        }
    }

    let mut write = cache.write().await;
    if let Some((models, timestamp)) = write.get(&cache_key) {
        if !models.is_empty() && now.duration_since(*timestamp) < cache_duration {
            return models.clone();
        }
        if models.is_empty() && now.duration_since(*timestamp) < error_cache_duration {
            return fallback_for_provider(provider);
        }
    }

    let api_key = match decrypt_key(&provider.encrypted_api_key, &state.config.master_key) {
        Ok(k) => k,
        Err(e) => {
            tracing::warn!("Failed to decrypt provider key for {}: {}", provider.id, e);
            write.insert(cache_key, (Vec::new(), now));
            return fallback_for_provider(provider);
        }
    };

    let res = match state.http_client
        .get(format!("{}/models", provider.base_url))
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("Failed to fetch models from {}: {}", provider.base_url, e);
            write.insert(cache_key, (Vec::new(), now));
            return fallback_for_provider(provider);
        }
    };

    if !res.status().is_success() {
        tracing::error!("Models endpoint returned status: {} for {}", res.status(), provider.base_url);
        write.insert(cache_key, (Vec::new(), now));
        return fallback_for_provider(provider);
    }

    let data: serde_json::Value = match res.json().await {
        Ok(d) => d,
        Err(e) => {
            tracing::error!("Failed to parse models response from {}: {}", provider.base_url, e);
            write.insert(cache_key, (Vec::new(), now));
            return fallback_for_provider(provider);
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
        tracing::warn!("Provider {} returned empty model list, using fallback", provider.base_url);
        fallback_for_provider(provider)
    } else {
        models
    };

    write.insert(cache_key, (models.clone(), now));
    models
}

fn fallback_for_provider(provider: &Provider) -> Vec<NimModel> {
    if let Some(def) = get_provider_definition(&provider.provider_type) {
        models_from_fallback(&def)
    } else {
        Vec::new()
    }
}

async fn validate_model(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let provider_id = params.get("provider_id").cloned().unwrap_or_default();
    let model_id = params.get("model_id").cloned().unwrap_or_default();

    if provider_id.is_empty() || model_id.is_empty() {
        return Ok(Json(json!({"valid": false, "error": "provider_id and model_id are required"})));
    }

    let provider: Provider = sqlx::query_as("SELECT * FROM providers WHERE id = ?1 AND user_id = ?2")
        .bind(&provider_id)
        .bind(&claims.sub)
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let api_key = match decrypt_key(&provider.encrypted_api_key, &state.config.master_key) {
        Ok(k) => k,
        Err(_) => return Ok(Json(json!({"valid": false, "error": "Failed to decrypt API key"}))),
    };

    let test_body = json!({
        "model": model_id,
        "messages": [{"role": "user", "content": "Hi"}],
        "max_tokens": 5,
        "stream": false,
    });

    let test_res = state.http_client
        .post(format!("{}/chat/completions", provider.base_url))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&test_body)
        .send()
        .await;

    match test_res {
        Ok(res) => {
            let status = res.status();
            if status.is_success() {
                Ok(Json(json!({"valid": true, "provider_id": provider_id, "model_id": model_id})))
            } else {
                let body = res.text().await.unwrap_or_default();
                tracing::warn!("Model validation failed for {}/{}: {} - {}", provider_id, model_id, status, body);
                let error_msg = if status == 404 {
                    format!("Model '{}' is not available on this provider (404).", model_id)
                } else {
                    format!("Model validation failed: {}", status)
                };
                Ok(Json(json!({
                    "valid": false,
                    "provider_id": provider_id,
                    "model_id": model_id,
                    "error": error_msg,
                    "status": status.as_u16()
                })))
            }
        }
        Err(e) => {
            tracing::error!("Model validation request failed: {}", e);
            Ok(Json(json!({"valid": false, "error": format!("Connection failed: {}", e)})))
        }
    }
}
