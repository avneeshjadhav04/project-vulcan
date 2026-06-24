use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};

use crate::{
    auth::{
        build_cookie, create_token, generate_csrf_token, hash_password, normalize_email,
        validate_email, validate_password, verify_password,
    },
    middleware::AppState,
    models::{LoginRequest, SignupRequest, User},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/setup-status", get(setup_status))
        .route("/auth/signup", post(signup))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/auth/csrf", get(csrf_token))
}

async fn setup_status(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM users WHERE is_active = 1"
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Setup status query error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(serde_json::json!({ "needs_setup": count == 0 })))
}

async fn signup(
    State(state): State<AppState>,
    Json(req): Json<SignupRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), StatusCode> {
    let email = normalize_email(&req.email);
    if let Err(e) = validate_email(&email) {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": e.to_string() })),
        ));
    }

    if let Err(e) = validate_password(&req.password) {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": e.to_string() })),
        ));
    }

    let hash = hash_password(&req.password).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Only allow signup when no active users exist. The first account becomes the master admin.
    let existing_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM users WHERE is_active = 1"
    )
    .fetch_one(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if existing_count > 0 {
        return Ok((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Signup is disabled. Contact your administrator." })),
        ));
    }

    let result = sqlx::query(
        "INSERT INTO users (email, password_hash, role, is_active) VALUES (?1, ?2, 'admin', 1)",
    )
    .bind(&email)
    .bind(&hash)
    .execute(&state.db)
    .await;

    match result {
        Ok(_) => Ok((
            StatusCode::CREATED,
            Json(serde_json::json!({
                "message": "Account created successfully",
                "role": "admin",
            })),
        )),
        Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() => Ok((
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": "Email already registered" })),
        )),
        Err(e) => {
            tracing::error!("Signup error: {}", e);
            Ok((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Internal server error" })),
            ))
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
            return Ok((
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Invalid email or password" })),
            )
                .into_response());
        }
    };

    if !verify_password(&req.password, &user.password_hash)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        return Ok((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Invalid email or password" })),
        )
            .into_response());
    }

    if user.is_active == 0 {
        return Ok((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Account disabled" })),
        )
            .into_response());
    }

    let token = create_token(&user.id, &user.email, &user.role, &state).map_err(|e| {
        tracing::error!("Token creation error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let csrf = generate_csrf_token();
    let secure = state.config.cookie_secure;

    let auth_cookie = build_cookie("token", &token, 86400, true, secure)?;
    let csrf_cookie = build_cookie("csrf_token", &csrf, 86400, false, secure)?;

    let mut headers = axum::http::HeaderMap::new();
    headers.append(axum::http::header::SET_COOKIE, auth_cookie);
    headers.append(axum::http::header::SET_COOKIE, csrf_cookie);

    Ok((
        headers,
        Json(serde_json::json!({
            "id": user.id,
            "email": user.email,
            "role": user.role,
            "csrf_token": csrf,
        })),
    )
        .into_response())
}

async fn logout(
    State(state): State<AppState>,
) -> Result<(axum::http::HeaderMap, StatusCode), StatusCode> {
    let secure = state.config.cookie_secure;
    let auth_cookie = build_cookie("token", "", -1, true, secure)?;
    let csrf_cookie = build_cookie("csrf_token", "", -1, false, secure)?;
    let mut headers = axum::http::HeaderMap::new();
    headers.append(axum::http::header::SET_COOKIE, auth_cookie);
    headers.append(axum::http::header::SET_COOKIE, csrf_cookie);
    Ok((headers, StatusCode::OK))
}

async fn csrf_token(
    State(state): State<AppState>,
) -> Result<(axum::http::HeaderMap, Json<serde_json::Value>), StatusCode> {
    let csrf = generate_csrf_token();
    let secure = state.config.cookie_secure;
    let csrf_cookie = build_cookie("csrf_token", &csrf, 86400, false, secure)?;
    let mut headers = axum::http::HeaderMap::new();
    headers.insert(axum::http::header::SET_COOKIE, csrf_cookie);
    Ok((headers, Json(serde_json::json!({ "csrf_token": csrf }))))
}
