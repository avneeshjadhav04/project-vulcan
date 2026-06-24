use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{get, patch},
    Router,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use crate::{middleware::AppState, models::Claims};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/automations",
            get(list_automations).post(create_automation),
        )
        .route(
            "/automations/{id}",
            patch(update_automation).delete(delete_automation),
        )
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Automation {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub description: Option<String>,
    pub cron_expression: String,
    pub action: String,
    pub is_enabled: i32,
    pub last_run_at: Option<String>,
    pub next_run_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Deserialize)]
struct CreateAutomationRequest {
    name: String,
    description: Option<String>,
    cron_expression: String,
    action: String,
}

#[derive(Deserialize)]
struct UpdateAutomationRequest {
    name: Option<String>,
    description: Option<String>,
    cron_expression: Option<String>,
    action: Option<String>,
    is_enabled: Option<bool>,
}

async fn list_automations(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<Vec<Automation>>, StatusCode> {
    let autos: Vec<Automation> =
        sqlx::query_as("SELECT * FROM automations WHERE user_id = ?1 ORDER BY created_at DESC")
            .bind(&claims.sub)
            .fetch_all(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(autos))
}

async fn create_automation(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Json(req): Json<CreateAutomationRequest>,
) -> Result<(StatusCode, Json<Automation>), StatusCode> {
    if req.name.trim().is_empty()
        || req.cron_expression.trim().is_empty()
        || req.action.trim().is_empty()
    {
        return Err(StatusCode::BAD_REQUEST);
    }

    let next_run = compute_next_run(&req.cron_expression);

    let automation: Automation = sqlx::query_as(
        "INSERT INTO automations (user_id, name, description, cron_expression, action, next_run_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING *"
    )
    .bind(&claims.sub)
    .bind(req.name.trim())
    .bind(req.description.as_deref())
    .bind(req.cron_expression.trim())
    .bind(req.action.trim())
    .bind(next_run)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Create automation error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok((StatusCode::CREATED, Json(automation)))
}

async fn update_automation(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
    Json(req): Json<UpdateAutomationRequest>,
) -> Result<Json<Automation>, StatusCode> {
    let existing: Automation =
        sqlx::query_as("SELECT * FROM automations WHERE id = ?1 AND user_id = ?2")
            .bind(&id)
            .bind(&claims.sub)
            .fetch_one(&state.db)
            .await
            .map_err(|_| StatusCode::NOT_FOUND)?;

    let next_run = req
        .cron_expression
        .as_ref()
        .map(|c| compute_next_run(c))
        .unwrap_or(existing.next_run_at.unwrap_or_default());

    let is_enabled = req.is_enabled.map(|v| if v { 1 } else { 0 });

    let updated: Automation = sqlx::query_as(
        "UPDATE automations SET name = COALESCE(?1, name), description = COALESCE(?2, description), cron_expression = COALESCE(?3, cron_expression), action = COALESCE(?4, action), is_enabled = COALESCE(?5, is_enabled), next_run_at = COALESCE(?6, next_run_at), updated_at = datetime('now') WHERE id = ?7 AND user_id = ?8 RETURNING *"
    )
    .bind(req.name.as_deref())
    .bind(req.description.as_deref())
    .bind(req.cron_expression.as_deref())
    .bind(req.action.as_deref())
    .bind(is_enabled)
    .bind(Some(&next_run))
    .bind(&id)
    .bind(&claims.sub)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Update automation error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(updated))
}

async fn delete_automation(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let result = sqlx::query("DELETE FROM automations WHERE id = ?1 AND user_id = ?2")
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

/// Parse a simple cron-like expression and compute the next run time.
/// Supports: "every N minutes", "every N hours", "every day at HH:MM"
fn compute_next_run(expr: &str) -> String {
    let now = chrono::Utc::now();
    let lower = expr.to_lowercase();

    if let Some(min_str) = lower
        .strip_prefix("every ")
        .and_then(|s| s.strip_suffix(" minutes"))
    {
        let mins: i64 = min_str.trim().parse().unwrap_or(5);
        (now + chrono::Duration::minutes(mins))
            .format("%Y-%m-%dT%H:%M:%SZ")
            .to_string()
    } else if let Some(hour_str) = lower
        .strip_prefix("every ")
        .and_then(|s| s.strip_suffix(" hours"))
    {
        let hours: i64 = hour_str.trim().parse().unwrap_or(1);
        (now + chrono::Duration::hours(hours))
            .format("%Y-%m-%dT%H:%M:%SZ")
            .to_string()
    } else if let Some(time_part) = lower.strip_prefix("every day at ") {
        let time_part = time_part.trim();
        let target = format!("{}T{}:00Z", now.format("%Y-%m-%d"), time_part);
        let target_dt = chrono::DateTime::parse_from_rfc3339(&target)
            .map(|dt| dt.with_timezone(&chrono::Utc))
            .unwrap_or_else(|_| {
                // If parsing fails, fall back to simple concatenation and add 1 day
                now + chrono::Duration::days(1)
            });
        // If the target time has already passed today, schedule for tomorrow
        if target_dt <= now {
            (target_dt + chrono::Duration::days(1))
                .format("%Y-%m-%dT%H:%M:%SZ")
                .to_string()
        } else {
            target_dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()
        }
    } else if let Some(sec_str) = lower
        .strip_prefix("every ")
        .and_then(|s| s.strip_suffix(" seconds"))
    {
        let secs: i64 = sec_str.trim().parse().unwrap_or(30);
        (now + chrono::Duration::seconds(secs))
            .format("%Y-%m-%dT%H:%M:%SZ")
            .to_string()
    } else {
        // Default: every 30 minutes
        (now + chrono::Duration::minutes(30))
            .format("%Y-%m-%dT%H:%M:%SZ")
            .to_string()
    }
}

/// Run due automations. Called periodically from the background task.
pub async fn run_due_automations(state: &AppState) {
    let autos: Vec<Automation> = match sqlx::query_as(
        "SELECT * FROM automations WHERE is_enabled = 1 AND next_run_at <= datetime('now') LIMIT 50"
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(a) => a,
        Err(e) => {
            tracing::warn!("Failed to load due automations: {}", e);
            return;
        }
    };

    for auto in autos {
        let action: serde_json::Value = match serde_json::from_str(&auto.action) {
            Ok(a) => a,
            Err(e) => {
                tracing::warn!("Invalid automation action {}: {}", auto.id, e);
                continue;
            }
        };

        let action_type = action["type"].as_str().unwrap_or("");

        match action_type {
            "chat_message" => {
                let prompt = action["prompt"].as_str().unwrap_or("");
                let model_id = action["model_id"]
                    .as_str()
                    .unwrap_or("nvidia/llama-3.1-nemotron-70b");

                if prompt.is_empty() {
                    continue;
                }

                tracing::info!(
                    "Running automation {}: {} -> {}",
                    auto.id,
                    auto.name,
                    prompt
                );

                let provider: Option<crate::models::Provider> = sqlx::query_as(
                    "SELECT * FROM providers WHERE user_id = ?1 AND is_active = 1 LIMIT 1",
                )
                .bind(&auto.user_id)
                .fetch_optional(&state.db)
                .await
                .unwrap_or(None);

                let (base_url, api_key, p_id) = if let Some(p) = provider {
                    let key =
                        crate::auth::decrypt_key(&p.encrypted_api_key, &state.config.master_key)
                            .unwrap_or_default();
                    (p.base_url, key, p.id)
                } else {
                    tracing::warn!("No active provider found for user {}", auto.user_id);
                    continue;
                };

                let chat_id = uuid::Uuid::new_v4().to_string();
                let _ = sqlx::query("INSERT INTO chats (id, user_id, title, model_id, provider_id) VALUES (?1, ?2, ?3, ?4, ?5)")
                    .bind(&chat_id)
                    .bind(&auto.user_id)
                    .bind(&auto.name)
                    .bind(model_id)
                    .bind(&p_id)
                    .execute(&state.db).await;

                let _ = sqlx::query("INSERT INTO messages (chat_id, role, content, tokens_used) VALUES (?1, 'user', ?2, ?3)")
                    .bind(&chat_id).bind(prompt).bind(prompt.len() as i32 / 4)
                    .execute(&state.db).await;

                let payload = serde_json::json!({
                    "model": model_id,
                    "messages": [
                        {"role": "user", "content": prompt}
                    ],
                    "stream": false
                });

                if let Ok(response) = state
                    .http_client
                    .post(format!("{}/chat/completions", base_url))
                    .header("Authorization", format!("Bearer {}", api_key))
                    .json(&payload)
                    .send()
                    .await
                {
                    if let Ok(data) = response.json::<serde_json::Value>().await {
                        if let Some(content) = data["choices"][0]["message"]["content"].as_str() {
                            let _ = sqlx::query("INSERT INTO messages (chat_id, role, content, tokens_used, provider_id, model_id) VALUES (?1, 'assistant', ?2, ?3, ?4, ?5)")
                                .bind(&chat_id).bind(content).bind(content.len() as i32 / 4).bind(&p_id).bind(model_id)
                                .execute(&state.db).await;
                        }
                    }
                }
            }
            _ => {
                tracing::warn!("Unknown automation action type: {}", action_type);
            }
        }

        // Update last_run_at and next_run_at
        let next_run = compute_next_run(&auto.cron_expression);
        let _ = sqlx::query(
            "UPDATE automations SET last_run_at = datetime('now'), next_run_at = ?1, updated_at = datetime('now') WHERE id = ?2"
        )
        .bind(&next_run)
        .bind(&auto.id)
        .execute(&state.db)
        .await;
    }
}
