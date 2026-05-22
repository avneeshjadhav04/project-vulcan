use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{Json, Redirect},
    routing::{delete, get},
    Router,
};
use serde::Deserialize;
use std::collections::HashMap;

use crate::{
    integrations,
    middleware::AppState,
    models::{Claims, IntegrationInfo},
    oauth,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/integrations", get(list_integrations))
        .route("/integrations/:provider/auth-url", get(auth_url))
        .route("/integrations/:provider/callback", get(oauth_callback))
        .route("/integrations/:provider", delete(disconnect))
}

#[derive(Deserialize)]
struct OAuthCallbackQuery {
    code: String,
    state: String,
    #[serde(default)]
    error: Option<String>,
}

async fn list_integrations(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<Vec<IntegrationInfo>>, StatusCode> {
    let credentials: Vec<(String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT provider, scopes, expires_at FROM integration_credentials WHERE user_id = ?1"
    )
    .bind(&claims.sub)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let connected_providers: HashMap<String, (Option<String>, Option<String>)> = credentials
        .into_iter()
        .map(|(p, s, e)| (p, (s, e)))
        .collect();

    let all_providers = vec!["google", "todoist"];

    let result: Vec<IntegrationInfo> = all_providers
        .into_iter()
        .map(|p| {
            if let Some((scopes, expires_at)) = connected_providers.get(p) {
                IntegrationInfo {
                    provider: p.to_string(),
                    connected: true,
                    scopes: scopes.clone(),
                    expires_at: expires_at.clone(),
                }
            } else {
                IntegrationInfo {
                    provider: p.to_string(),
                    connected: false,
                    scopes: None,
                    expires_at: None,
                }
            }
        })
        .collect();

    Ok(Json(result))
}

async fn auth_url(
    State(state): State<AppState>,
    _claims: axum::Extension<Claims>,
    Path(provider): Path<String>,
) -> Result<impl axum::response::IntoResponse, StatusCode> {
    let (config, state_param, challenge, _verifier) = match provider.as_str() {
        "google" => {
            let cfg = integrations::google::google_oauth_config(&state)
                .ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
            let pkce = oauth::generate_pkce_pair();
            let s = oauth::generate_state();
            (cfg, s, pkce.challenge, pkce.verifier)
        }
        "todoist" => {
            let cfg = integrations::todoist::todoist_oauth_config(&state)
                .ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
            let pkce = oauth::generate_pkce_pair();
            let s = oauth::generate_state();
            (cfg, s, pkce.challenge, pkce.verifier)
        }
        _ => return Err(StatusCode::NOT_FOUND),
    };

    let url = oauth::build_auth_url(&config, &state_param, &challenge);

    let cookie_value = format!("{}:{}", state_param, _verifier);
    let cookie_str = format!("oauth_state={}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax", cookie_value);
    
    let mut headers = axum::http::HeaderMap::new();
    headers.insert(axum::http::header::SET_COOKIE, cookie_str.parse().unwrap());

    Ok((headers, Json(serde_json::json!({"url": url}))))
}

async fn oauth_callback(
    headers: axum::http::HeaderMap,
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(provider): Path<String>,
    Query(query): Query<OAuthCallbackQuery>,
) -> Result<impl axum::response::IntoResponse, StatusCode> {
    if let Some(error) = query.error {
        tracing::warn!("OAuth callback error for {}: {}", provider, error);
        return Err(StatusCode::BAD_REQUEST);
    }

    let cookie_header = headers.get(axum::http::header::COOKIE)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");

    let mut stored_state = None;
    let mut stored_verifier = None;
    for c in cookie_header.split(';') {
        let c = c.trim();
        if c.starts_with("oauth_state=") {
            let val = &c["oauth_state=".len()..];
            let parts: Vec<&str> = val.split(':').collect();
            if parts.len() == 2 {
                stored_state = Some(parts[0].to_string());
                stored_verifier = Some(parts[1].to_string());
            }
        }
    }

    if stored_state.is_none() || stored_state.unwrap() != query.state {
        tracing::warn!("OAuth CSRF validation failed");
        return Err(StatusCode::BAD_REQUEST);
    }
    
    let verifier = stored_verifier.unwrap();

    let config = match provider.as_str() {
        "google" => integrations::google::google_oauth_config(&state)
            .ok_or(StatusCode::SERVICE_UNAVAILABLE)?,
        "todoist" => integrations::todoist::todoist_oauth_config(&state)
            .ok_or(StatusCode::SERVICE_UNAVAILABLE)?,
        _ => return Err(StatusCode::NOT_FOUND),
    };

    let token = oauth::exchange_code(&state.http_client, &config, &query.code, &verifier)
        .await
        .map_err(|e| {
            tracing::error!("Token exchange failed: {}", e);
            StatusCode::BAD_REQUEST
        })?;

    let encrypted_access = oauth::encrypt_token(&token.access_token, &state.config.master_key)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let encrypted_refresh = token.refresh_token.as_ref()
        .map(|rt| oauth::encrypt_token(rt, &state.config.master_key))
        .transpose()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let expires_at = oauth::compute_expiry(token.expires_in);

    let scopes_str = config.scopes.join(" ");

    sqlx::query(
        "INSERT INTO integration_credentials (user_id, provider, encrypted_access_token, encrypted_refresh_token, expires_at, scopes) 
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(user_id, provider) DO UPDATE SET 
           encrypted_access_token = excluded.encrypted_access_token,
           encrypted_refresh_token = COALESCE(excluded.encrypted_refresh_token, integration_credentials.encrypted_refresh_token),
           expires_at = excluded.expires_at,
           scopes = excluded.scopes,
           updated_at = datetime('now')"
    )
    .bind(&claims.sub)
    .bind(&provider)
    .bind(&encrypted_access)
    .bind(encrypted_refresh.as_deref())
    .bind(&expires_at)
    .bind(&scopes_str)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to save integration: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let clear_cookie = "oauth_state=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax";
    let mut headers = axum::http::HeaderMap::new();
    headers.insert(axum::http::header::SET_COOKIE, clear_cookie.parse().unwrap());

    // Redirect back to settings page
    let redirect_url = format!("{}/settings?integration={}&status=connected", state.config.app_base_url, provider);
    Ok((headers, Redirect::to(&redirect_url)))
}

async fn disconnect(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(provider): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let result = sqlx::query(
        "DELETE FROM integration_credentials WHERE user_id = ?1 AND provider = ?2"
    )
    .bind(&claims.sub)
    .bind(&provider)
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if result.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    Ok(StatusCode::NO_CONTENT)
}
