use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use crate::{
    middleware::AppState,
    models::TerminalSession,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/terminal-logs", get(list_terminal_logs))
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
