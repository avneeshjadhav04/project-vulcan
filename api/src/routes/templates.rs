use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get, post},
    Router,
};
use std::collections::HashMap;

use crate::{middleware::AppState, models::Claims};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/templates", get(list_templates).post(create_template))
        .route("/templates/:id", delete(delete_template))
}

#[derive(serde::Deserialize)]
struct CreateTemplateRequest {
    title: String,
    content: String,
    shortcut: Option<String>,
}

async fn list_templates(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<Vec<serde_json::Value>>, StatusCode> {
    let templates: Vec<(String, String, String, Option<String>, i32)> = sqlx::query_as(
        "SELECT id, title, content, shortcut, is_builtin FROM prompt_templates 
         WHERE user_id = ?1 OR is_builtin = 1 
         ORDER BY is_builtin DESC, created_at DESC"
    )
    .bind(&claims.sub)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let result = templates.into_iter().map(|(id, title, content, shortcut, is_builtin)| {
        serde_json::json!({
            "id": id,
            "title": title,
            "content": content,
            "shortcut": shortcut,
            "is_builtin": is_builtin == 1,
        })
    }).collect();

    Ok(Json(result))
}

async fn create_template(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Json(req): Json<CreateTemplateRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), StatusCode> {
    if req.title.is_empty() || req.content.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let id = uuid::Uuid::new_v4().to_string().replace("-", "");
    
    sqlx::query(
        "INSERT INTO prompt_templates (id, user_id, title, content, shortcut) VALUES (?1, ?2, ?3, ?4, ?5)"
    )
    .bind(&id)
    .bind(&claims.sub)
    .bind(&req.title)
    .bind(&req.content)
    .bind(req.shortcut.as_deref())
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "id": id,
        "title": req.title,
        "content": req.content,
        "shortcut": req.shortcut,
        "is_builtin": false,
    }))))
}

async fn delete_template(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let result = sqlx::query(
        "DELETE FROM prompt_templates WHERE id = ?1 AND user_id = ?2 AND is_builtin = 0"
    )
    .bind(&id)
    .bind(&claims.sub)
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if result.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    Ok(StatusCode::NO_CONTENT)
}
