use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get, post},
    Router,
};
use serde_json::json;

use crate::{
    auth::{decrypt_key, encrypt_key},
    middleware::AppState,
    models::{Claims, CreateProviderRequest, Provider, ProviderResponse, UpdateProviderRequest},
    providers::get_provider_definition,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/providers", get(list_providers).post(create_provider))
        .route(
            "/providers/{id}",
            delete(delete_provider).patch(update_provider),
        )
        .route("/providers/{id}/validate", post(validate_provider))
}

async fn list_providers(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<Vec<ProviderResponse>>, StatusCode> {
    let providers: Vec<Provider> =
        sqlx::query_as("SELECT * FROM providers WHERE user_id = ?1 ORDER BY created_at ASC")
            .bind(&claims.sub)
            .fetch_all(&state.db)
            .await
            .map_err(|e| {
                tracing::error!("List providers error: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;

    let responses: Vec<ProviderResponse> = providers
        .into_iter()
        .map(|p| ProviderResponse {
            id: p.id,
            name: p.name,
            provider_type: p.provider_type,
            base_url: p.base_url,
            is_active: p.is_active == 1,
        })
        .collect();

    Ok(Json(responses))
}

async fn create_provider(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Json(req): Json<CreateProviderRequest>,
) -> Result<(StatusCode, Json<ProviderResponse>), StatusCode> {
    let name = req.name.trim();
    let provider_type = req.provider_type.trim();
    let base_url = req.base_url.trim();
    let api_key = req.api_key.trim();

    if name.is_empty() || provider_type.is_empty() || base_url.is_empty() || api_key.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Validate provider_type is known or custom
    let is_known = get_provider_definition(provider_type).is_some();
    if !is_known && provider_type != "custom" {
        return Err(StatusCode::BAD_REQUEST);
    }

    let final_base_url = if let Some(def) = get_provider_definition(provider_type) {
        // For built-in providers, if user didn't customize base_url, use default
        if base_url.is_empty() || base_url == def.base_url {
            def.base_url.to_string()
        } else {
            base_url.to_string()
        }
    } else {
        base_url.to_string()
    };

    let encrypted = encrypt_key(api_key, &state.config.master_key).map_err(|e| {
        tracing::error!("Encrypt provider key error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let provider: Provider = sqlx::query_as(
        "INSERT INTO providers (user_id, name, provider_type, base_url, encrypted_api_key) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING *"
    )
    .bind(&claims.sub)
    .bind(name)
    .bind(provider_type)
    .bind(&final_base_url)
    .bind(&encrypted)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Create provider error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok((
        StatusCode::CREATED,
        Json(ProviderResponse {
            id: provider.id,
            name: provider.name,
            provider_type: provider.provider_type,
            base_url: provider.base_url,
            is_active: provider.is_active == 1,
        }),
    ))
}

async fn delete_provider(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let result = sqlx::query("DELETE FROM providers WHERE id = ?1 AND user_id = ?2")
        .bind(&id)
        .bind(&claims.sub)
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Delete provider error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if result.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn update_provider(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
    Json(req): Json<UpdateProviderRequest>,
) -> Result<Json<ProviderResponse>, StatusCode> {
    let provider: Provider =
        sqlx::query_as("SELECT * FROM providers WHERE id = ?1 AND user_id = ?2")
            .bind(&id)
            .bind(&claims.sub)
            .fetch_one(&state.db)
            .await
            .map_err(|_| StatusCode::NOT_FOUND)?;

    let mut encrypted = provider.encrypted_api_key;
    if let Some(new_key) = req.api_key {
        let trimmed = new_key.trim();
        if !trimmed.is_empty() {
            encrypted = encrypt_key(trimmed, &state.config.master_key).map_err(|e| {
                tracing::error!("Encrypt provider key error: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
        }
    }

    let is_active = req.is_active.map(|v| if v { 1 } else { 0 });

    let updated: Provider = sqlx::query_as(
        "UPDATE providers SET encrypted_api_key = COALESCE(?1, encrypted_api_key), is_active = COALESCE(?2, is_active), updated_at = datetime('now') WHERE id = ?3 AND user_id = ?4 RETURNING *"
    )
    .bind(&encrypted)
    .bind(is_active)
    .bind(&id)
    .bind(&claims.sub)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Update provider error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(ProviderResponse {
        id: updated.id,
        name: updated.name,
        provider_type: updated.provider_type,
        base_url: updated.base_url,
        is_active: updated.is_active == 1,
    }))
}

async fn validate_provider(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let provider: Provider =
        sqlx::query_as("SELECT * FROM providers WHERE id = ?1 AND user_id = ?2")
            .bind(&id)
            .bind(&claims.sub)
            .fetch_one(&state.db)
            .await
            .map_err(|_| StatusCode::NOT_FOUND)?;

    let api_key = decrypt_key(&provider.encrypted_api_key, &state.config.master_key)
        .map_err(|_| StatusCode::BAD_REQUEST)?;

    let test_res = state
        .http_client
        .get(format!("{}/models", provider.base_url))
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await;

    match test_res {
        Ok(res) => {
            let status = res.status();
            if status.is_success() {
                Ok(Json(
                    json!({"valid": true, "provider_id": id, "status": status.as_u16()}),
                ))
            } else {
                let body = res.text().await.unwrap_or_default();
                tracing::warn!(
                    "Provider validation failed for {}: {} - {}",
                    id,
                    status,
                    body
                );
                Ok(Json(json!({
                    "valid": false,
                    "provider_id": id,
                    "error": format!("Provider returned {}", status),
                    "status": status.as_u16()
                })))
            }
        }
        Err(e) => {
            tracing::error!("Provider validation request failed: {}", e);
            Ok(Json(
                json!({"valid": false, "error": format!("Connection failed: {}", e)}),
            ))
        }
    }
}
