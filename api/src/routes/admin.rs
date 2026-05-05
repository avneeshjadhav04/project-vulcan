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
        "SELECT id, email, role, created_at, updated_at FROM users ORDER BY created_at DESC LIMIT 1000"
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

    // Atomic check: prevent deleting the last admin
    let result = sqlx::query(
        "DELETE FROM users WHERE id = ?1 AND (role != 'admin' OR (role = 'admin' AND (SELECT COUNT(*) FROM users WHERE role = 'admin') > 1))"
    )
    .bind(&id)
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
