use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::post,
    Router,
};

use crate::{
    auth::{create_token, hash_password, normalize_email, validate_password, verify_password, generate_csrf_token},
    middleware::AppState,
    models::{LoginRequest, SignupRequest, User},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/signup", post(signup))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/auth/csrf", post(csrf_token))
}

async fn signup(
    State(state): State<AppState>,
    Json(req): Json<SignupRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), StatusCode> {
    let email = normalize_email(&req.email);
    if email.is_empty() {
        return Ok((StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Email is required" }))));
    }

    if let Err(e) = validate_password(&req.password) {
        return Ok((StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e.to_string() }))));
    }

    let hash = hash_password(&req.password).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let result = sqlx::query("INSERT INTO users (email, password_hash) VALUES (?1, ?2)")
        .bind(&email)
        .bind(&hash)
        .execute(&state.db)
        .await;

    match result {
        Ok(_) => Ok((StatusCode::CREATED, Json(serde_json::json!({ "message": "Account created successfully" })))),
        Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() => {
            Ok((StatusCode::CONFLICT, Json(serde_json::json!({ "error": "Email already registered" }))))
        }
        Err(e) => {
            tracing::error!("Signup error: {}", e);
            Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "Internal server error" }))))
        }
    }
}

async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> Result<axum::response::Response, StatusCode> {
    let email = normalize_email(&req.email);

    let user: Option<User> = sqlx::query_as("SELECT * FROM users WHERE email = ?1")
        .bind(&email)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Login query error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let user = match user {
        Some(u) => u,
        None => {
            // Timing attack mitigation: perform dummy password verification
            let _ = verify_password(&req.password, "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
            return Ok((StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Invalid email or password" }))).into_response());
        }
    };

    if !verify_password(&req.password, &user.password_hash).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)? {
        return Ok((StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Invalid email or password" }))).into_response());
    }

    let token = create_token(&user.id, &user.email, &user.role, &state)
        .map_err(|e| {
            tracing::error!("Token creation error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let csrf = generate_csrf_token();

    let auth_cookie = format!(
        "token={}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400; Secure",
        token
    );
    let csrf_cookie = format!(
        "csrf_token={}; SameSite=Strict; Path=/; Max-Age=86400; Secure",
        csrf
    );

    let mut headers = axum::http::HeaderMap::new();
    headers.insert(axum::http::header::SET_COOKIE, auth_cookie.parse().unwrap());
    headers.insert(axum::http::header::SET_COOKIE, csrf_cookie.parse().unwrap());

    Ok((headers, Json(serde_json::json!({
        "id": user.id,
        "email": user.email,
        "role": user.role,
        "has_nim_key": user.encrypted_nim_key.is_some(),
        "csrf_token": csrf,
    }))).into_response())
}

async fn logout() -> (axum::http::HeaderMap, StatusCode) {
    let auth_cookie = "token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure";
    let csrf_cookie = "csrf_token=; SameSite=Strict; Path=/; Max-Age=0; Secure";
    let mut headers = axum::http::HeaderMap::new();
    headers.insert(axum::http::header::SET_COOKIE, auth_cookie.parse().unwrap());
    headers.insert(axum::http::header::SET_COOKIE, csrf_cookie.parse().unwrap());
    (headers, StatusCode::OK)
}

async fn csrf_token() -> Result<(axum::http::HeaderMap, Json<serde_json::Value>), StatusCode> {
    let csrf = generate_csrf_token();
    let csrf_cookie = format!(
        "csrf_token={}; SameSite=Strict; Path=/; Max-Age=86400; Secure",
        csrf
    );
    let mut headers = axum::http::HeaderMap::new();
    headers.insert(axum::http::header::SET_COOKIE, csrf_cookie.parse().unwrap());
    Ok((headers, Json(serde_json::json!({ "csrf_token": csrf }))))
}
