use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get},
    Router,
};
use serde_json::json;
use crate::{
    middleware::AppState,
    models::{Claims, TerminalSession, User},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/users", get(list_users))
        .route("/admin/users/:id", delete(delete_user))
        .route("/admin/terminal-logs", get(list_terminal_logs))
}

async fn list_users(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let users: Vec<User> = sqlx::query_as(
        "SELECT id, email, password_hash, encrypted_nim_key, role, created_at, updated_at FROM users ORDER BY created_at DESC LIMIT 1000"
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Admin list users error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let safe_users: Vec<serde_json::Value> = users
        .into_iter()
        .map(|u| {
            json!({
                "id": u.id,
                "email": u.email,
                "role": u.role,
                "created_at": u.created_at,
            })
        })
        .collect();

    Ok(Json(json!({ "users": safe_users })))
}

async fn delete_user(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    // Prevent self-deletion
    if id == claims.sub {
        return Err(StatusCode::FORBIDDEN);
    }

    // Prevent deleting the last admin
    let admin_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE role = 'admin'")
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Admin count query error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let target: Option<User> = sqlx::query_as("SELECT * FROM users WHERE id = ?1")
        .bind(&id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Admin target user query error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if let Some(ref user) = target {
        if user.role == "admin" && admin_count <= 1 {
            return Err(StatusCode::FORBIDDEN);
        }
    } else {
        return Err(StatusCode::NOT_FOUND);
    }

    let result = sqlx::query("DELETE FROM users WHERE id = ?1")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Admin delete user error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if result.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn list_terminal_logs(
    State(state): State<AppState>,
) -> Result<Json<Vec<TerminalSession>>, StatusCode> {
    let logs: Vec<TerminalSession> = sqlx::query_as(
        "SELECT * FROM terminal_sessions ORDER BY started_at DESC LIMIT 100"
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Admin list logs error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(logs))
}
