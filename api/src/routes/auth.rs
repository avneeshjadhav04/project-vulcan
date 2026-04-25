use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::post,
    Router,
};

use crate::{
    auth::{create_token, hash_password, verify_password},
    middleware::AppState,
    models::{LoginRequest, SignupRequest, User},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/signup", post(signup))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
}

async fn signup(
    State(state): State<AppState>,
    Json(req): Json<SignupRequest>,
) -> Result<StatusCode, StatusCode> {
    if req.email.is_empty() || req.password.len() < 6 {
        return Err(StatusCode::BAD_REQUEST);
    }

    let hash = hash_password(&req.password).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let result = sqlx::query("INSERT INTO users (email, password_hash) VALUES ($1, $2)")
        .bind(&req.email)
        .bind(&hash)
        .execute(&state.db)
        .await;

    match result {
        Ok(_) => Ok(StatusCode::CREATED),
        Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() => {
            Err(StatusCode::CONFLICT)
        }
        Err(e) => {
            tracing::error!("Signup error: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> Result<(axum::http::HeaderMap, Json<serde_json::Value>), StatusCode> {
    let user: Option<User> = sqlx::query_as("SELECT * FROM users WHERE email = $1")
        .bind(&req.email)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Login query error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let user = match user {
        Some(u) => u,
        None => return Err(StatusCode::UNAUTHORIZED),
    };

    if !verify_password(&req.password, &user.password_hash).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)? {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let token = create_token(&user.id, &user.email, &user.role, &state.config)
        .map_err(|e| {
            tracing::error!("Token creation error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let cookie = format!(
        "token={}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400",
        token
    );

    let mut headers = axum::http::HeaderMap::new();
    headers.insert(axum::http::header::SET_COOKIE, cookie.parse().unwrap());

    Ok((headers, Json(serde_json::json!({ "role": user.role }))))
}

async fn logout() -> (axum::http::HeaderMap, StatusCode) {
    let cookie = "token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
    let mut headers = axum::http::HeaderMap::new();
    headers.insert(axum::http::header::SET_COOKIE, cookie.parse().unwrap());
    (headers, StatusCode::OK)
}
