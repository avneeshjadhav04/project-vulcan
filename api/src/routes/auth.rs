use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};

use crate::{
    auth::{
        create_token, generate_csrf_token, hash_password, normalize_email, validate_email,
        validate_password, verify_password,
    },
    middleware::AppState,
    models::{LoginRequest, SignupRequest, User},
};

fn build_cookie(
    name: &str,
    value: &str,
    max_age: i64,
    http_only: bool,
    secure: bool,
) -> Result<axum::http::HeaderValue, StatusCode> {
    let mut parts = vec![
        format!("{}={}", name, value),
        "SameSite=Lax".to_string(),
        "Path=/".to_string(),
    ];
    if http_only {
        parts.push("HttpOnly".to_string());
    }
    if secure {
        parts.push("Secure".to_string());
    }
    if max_age >= 0 {
        parts.push(format!("Max-Age={}", max_age));
    } else {
        parts.push("Max-Age=0".to_string());
    }
    axum::http::HeaderValue::from_str(&parts.join("; "))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/signup", post(signup))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/auth/csrf", get(csrf_token))
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

    let result = sqlx::query("INSERT INTO users (email, password_hash) VALUES (?1, ?2)")
        .bind(&email)
        .bind(&hash)
        .execute(&state.db)
        .await;

    match result {
        Ok(_) => Ok((
            StatusCode::CREATED,
            Json(serde_json::json!({ "message": "Account created successfully" })),
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
