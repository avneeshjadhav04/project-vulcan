use axum::{
    extract::{Extension, Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::{
    auth::build_cookie,
    browser_engine::BrowserState,
    config::Config,
    models::Claims,
    mcp::McpManager,
    routes::chat::ActiveStream,
    sandbox_engine::SandboxState,
};

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub db: sqlx::SqlitePool,
    pub http_client: reqwest::Client,
    pub jwt_public_key: Option<Vec<u8>>,
    pub sandbox: SandboxState,
    pub browser: BrowserState,
    pub vosk_model: Option<std::sync::Arc<std::sync::Mutex<vosk::Model>>>,
    pub mcp_manager: McpManager,
    pub active_streams: Arc<RwLock<HashMap<String, Arc<ActiveStream>>>>,
}

pub async fn auth_middleware(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, Response> {
    let cookie_header = request
        .headers()
        .get(axum::http::header::COOKIE)
        .and_then(|v| v.to_str().ok());

    let token = cookie_header.and_then(|cookies| {
        cookies.split(';').find_map(|c| {
            let (name, value) = c.trim().split_once('=')?;
            if name == "token" {
                Some(value.to_string())
            } else {
                None
            }
        })
    });

    let claims = match token {
        Some(t) => crate::auth::verify_token(&t, &state).map_err(|e| {
            tracing::warn!("Token verification failed: {}", e);
            StatusCode::UNAUTHORIZED.into_response()
        })?,
        None => return Err(StatusCode::UNAUTHORIZED.into_response()),
    };

    // Reject disabled accounts immediately rather than letting the token expire.
    let is_active: Option<(i32,)> = sqlx::query_as("SELECT is_active FROM users WHERE id = ?1")
        .bind(&claims.sub)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Auth middleware user status lookup failed: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        })?;

    match is_active {
        Some((1,)) => {}
        Some((0,)) => {
            // Clear auth cookies in the response so the client stops retrying
            // with a disabled session and breaks any redirect loop.
            let secure = state.config.cookie_secure;
            let clear_token = build_cookie("token", "", -1, true, secure)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())?;
            let clear_csrf = build_cookie("csrf_token", "", -1, false, secure)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())?;
            let mut headers = axum::http::HeaderMap::new();
            headers.append(axum::http::header::SET_COOKIE, clear_token);
            headers.append(axum::http::header::SET_COOKIE, clear_csrf);
            return Err((
                StatusCode::FORBIDDEN,
                headers,
                axum::Json(serde_json::json!({ "error": "Account disabled" })),
            )
                .into_response());
        }
        _ => {
            return Err((
                StatusCode::UNAUTHORIZED,
                axum::Json(serde_json::json!({ "error": "User not found" })),
            )
                .into_response());
        }
    }

    request.extensions_mut().insert(claims);
    Ok(next.run(request).await)
}

pub async fn require_admin_middleware(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let role: Option<(String,)> = sqlx::query_as("SELECT role FROM users WHERE id = ?1")
        .bind(&claims.sub)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Admin middleware role lookup failed: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    match role {
        Some((role,)) if role == "admin" => Ok(next.run(request).await),
        _ => Err(StatusCode::FORBIDDEN),
    }
}

pub async fn csrf_middleware(request: Request, next: Next) -> Result<Response, StatusCode> {
    let method = request.method().clone();
    // Only check CSRF for state-changing methods
    if method != axum::http::Method::GET
        && method != axum::http::Method::HEAD
        && method != axum::http::Method::OPTIONS
    {
        let cookie_header = request
            .headers()
            .get(axum::http::header::COOKIE)
            .and_then(|v| v.to_str().ok());

        let csrf_cookie = cookie_header.and_then(|cookies| {
            cookies.split(';').find_map(|c| {
                let (name, value) = c.trim().split_once('=')?;
                if name == "csrf_token" {
                    Some(value.to_string())
                } else {
                    None
                }
            })
        });

        let csrf_header = request
            .headers()
            .get("x-csrf-token")
            .and_then(|v| v.to_str().ok());

        match (csrf_cookie, csrf_header) {
            (Some(cookie), Some(header)) if cookie == header => {}
            _ => {
                tracing::warn!("CSRF validation failed: method={}", method);
                return Err(StatusCode::FORBIDDEN);
            }
        }
    }

    Ok(next.run(request).await)
}
