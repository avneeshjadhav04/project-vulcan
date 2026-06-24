use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    response::Json,
    routing::{get, patch},
    Router,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::{hash_password, normalize_email, validate_email, validate_password},
    middleware::AppState,
    models::Claims,
};

const VALID_ROLES: [&str; 2] = ["user", "admin"];

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct UserListItem {
    pub id: String,
    pub email: String,
    pub role: String,
    pub is_active: i32,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    pub email: String,
    pub password: String,
    pub role: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserRequest {
    pub role: Option<String>,
    pub is_active: Option<bool>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/users", get(list_users).post(create_user))
        .route("/admin/users/:id", patch(update_user).delete(delete_user))
}

fn parse_role(role: Option<String>) -> Result<String, (StatusCode, Json<serde_json::Value>)> {
    let role = role.unwrap_or_else(|| "user".to_string());
    if !VALID_ROLES.contains(&role.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Invalid role. Must be 'user' or 'admin'." })),
        ));
    }
    Ok(role)
}

async fn list_users(
    State(state): State<AppState>,
) -> Result<Json<Vec<UserListItem>>, StatusCode> {
    let users = sqlx::query_as::<_, UserListItem>(
        "SELECT id, email, role, is_active, created_at FROM users ORDER BY created_at ASC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list users: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(users))
}

async fn create_user(
    State(state): State<AppState>,
    Extension(_claims): Extension<Claims>,
    Json(req): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<UserListItem>), (StatusCode, Json<serde_json::Value>)> {
    let email = normalize_email(&req.email);
    if let Err(e) = validate_email(&email) {
        return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e.to_string() }))));
    }
    if let Err(e) = validate_password(&req.password) {
        return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e.to_string() }))));
    }
    let role = parse_role(req.role)?;

    let hash = hash_password(&req.password).map_err(|e| {
        tracing::error!("Password hash error: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "Internal server error" })))
    })?;

    let result = sqlx::query_as::<_, UserListItem>(
        "INSERT INTO users (email, password_hash, role, is_active) VALUES (?1, ?2, ?3, 1) RETURNING id, email, role, is_active, created_at",
    )
    .bind(&email)
    .bind(&hash)
    .bind(&role)
    .fetch_one(&state.db)
    .await;

    match result {
        Ok(user) => Ok((StatusCode::CREATED, Json(user))),
        Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() => Err((
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": "Email already registered" })),
        )),
        Err(e) => {
            tracing::error!("Admin create user error: {}", e);
            Err((StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "Internal server error" }))))
        }
    }
}

async fn update_user(
    State(state): State<AppState>,
    Extension(_claims): Extension<Claims>,
    Path(user_id): Path<String>,
    Json(req): Json<UpdateUserRequest>,
) -> Result<Json<UserListItem>, (StatusCode, Json<serde_json::Value>)> {
    let mut set_clauses = Vec::new();
    let mut role_value: Option<String> = None;
    let mut is_active_value: Option<i32> = None;

    if let Some(role) = req.role {
        if !VALID_ROLES.contains(&role.as_str()) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "Invalid role. Must be 'user' or 'admin'." })),
            ));
        }
        set_clauses.push("role = ?");
        role_value = Some(role);
    }
    if let Some(is_active) = req.is_active {
        set_clauses.push("is_active = ?");
        is_active_value = Some(if is_active { 1 } else { 0 });
    }

    if set_clauses.is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "No fields to update" }))));
    }

    set_clauses.push("updated_at = datetime('now')");
    let sql = format!(
        "UPDATE users SET {} WHERE id = ? RETURNING id, email, role, is_active, created_at",
        set_clauses.join(", ")
    );

    let mut query = sqlx::query_as::<_, UserListItem>(&sql).bind(&user_id);
    if let Some(role) = role_value {
        query = query.bind(role);
    }
    if let Some(is_active) = is_active_value {
        query = query.bind(is_active);
    }

    match query.fetch_one(&state.db).await {
        Ok(user) => Ok(Json(user)),
        Err(sqlx::Error::RowNotFound) => Err((StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "User not found" })))),
        Err(e) => {
            tracing::error!("Admin update user error: {}", e);
            Err((StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "Internal server error" }))))
        }
    }
}

async fn delete_user(
    State(state): State<AppState>,
    Extension(_claims): Extension<Claims>,
    Path(user_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let result = sqlx::query("DELETE FROM users WHERE id = ?1")
        .bind(&user_id)
        .execute(&state.db)
        .await;

    match result {
        Ok(res) if res.rows_affected() > 0 => Ok(StatusCode::NO_CONTENT),
        Ok(_) => Ok(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Admin delete user error: {}", e);
            Err((StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "Internal server error" }))))
        }
    }
}
