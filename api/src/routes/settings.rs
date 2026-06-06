use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{get, put},
    Router,
};

use crate::{
    middleware::AppState,
    models::{Claims, ToolPermission, UpdateToolPermissionRequest},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/settings/tool-permissions", get(get_tool_permissions))
        .route("/settings/tool-permissions/:tool", put(update_tool_permission))
}

async fn get_tool_permissions(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<Vec<ToolPermission>>, StatusCode> {
    let permissions = sqlx::query_as::<_, ToolPermission>(
        "SELECT * FROM tool_permissions WHERE user_id = ?1",
    )
    .bind(&claims.sub)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch tool permissions: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(permissions))
}

async fn update_tool_permission(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(tool_name): Path<String>,
    Json(payload): Json<UpdateToolPermissionRequest>,
) -> Result<Json<ToolPermission>, (StatusCode, String)> {
    if payload.permission_level != "auto" && payload.permission_level != "ask" && payload.permission_level != "deny" {
        return Err((StatusCode::BAD_REQUEST, "Invalid permission level. Must be 'auto', 'ask', or 'deny'.".to_string()));
    }

    let perm = sqlx::query_as::<_, ToolPermission>(
        r#"
        INSERT INTO tool_permissions (user_id, tool_name, permission_level)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(user_id, tool_name) DO UPDATE SET
            permission_level = excluded.permission_level,
            updated_at = datetime('now')
        RETURNING *
        "#
    )
    .bind(&claims.sub)
    .bind(&tool_name)
    .bind(&payload.permission_level)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to update tool permission: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, "Database error".to_string())
    })?;

    Ok(Json(perm))
}
