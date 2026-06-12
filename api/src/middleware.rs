use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};

use crate::{config::Config, sandbox_engine::SandboxState};

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub db: sqlx::SqlitePool,
    pub http_client: reqwest::Client,
    pub jwt_public_key: Option<Vec<u8>>,
    pub sandbox: SandboxState,
    pub vosk_model: Option<std::sync::Arc<std::sync::Mutex<vosk::Model>>>,
}

pub async fn auth_middleware(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
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
            StatusCode::UNAUTHORIZED
        })?,
        None => return Err(StatusCode::UNAUTHORIZED),
    };

    request.extensions_mut().insert(claims);
    Ok(next.run(request).await)
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
