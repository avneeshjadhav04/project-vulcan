use crate::{
    middleware::AppState,
    models::IntegrationCredential,
    oauth,
};
use serde_json::json;

pub fn todoist_oauth_config(state: &AppState) -> Option<oauth::OAuthConfig> {
    let client_id = state.config.todoist_client_id.clone()?;
    let client_secret = state.config.todoist_client_secret.clone()?;
    let redirect_uri = format!("{}/api/integrations/todoist/callback", state.config.app_base_url);

    Some(oauth::OAuthConfig {
        client_id,
        client_secret,
        auth_url: "https://todoist.com/oauth/authorize".to_string(),
        token_url: "https://todoist.com/oauth/access_token".to_string(),
        redirect_uri,
        scopes: vec!["data:read_write".to_string()],
    })
}

async fn get_credential(
    state: &AppState,
    user_id: &str,
) -> Result<IntegrationCredential, String> {
    sqlx::query_as::<_, IntegrationCredential>(
        "SELECT * FROM integration_credentials WHERE user_id = ?1 AND provider = 'todoist'"
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| "Todoist not connected. Go to Settings to connect.".to_string())
}

pub async fn get_valid_token(
    state: &AppState,
    credential: &mut IntegrationCredential,
) -> Result<String, String> {
    let _config = todoist_oauth_config(state).ok_or("Todoist OAuth not configured")?;
    let token = oauth::decrypt_token(&credential.encrypted_access_token, &state.config.master_key)?;
    // Todoist tokens don't expire, but refresh if needed
    Ok(token)
}

// ─── Task APIs ───

pub async fn list_tasks(
    state: &AppState,
    user_id: &str,
    params: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut cred = get_credential(state, user_id).await?;
    let token = get_valid_token(state, &mut cred).await?;

    let filter = params["filter"].as_str().unwrap_or("");
    let mut url = "https://api.todoist.com/rest/v2/tasks".to_string();
    if !filter.is_empty() {
        url = format!("{}?filter={}", url, urlencoding::encode(filter));
    }

    let res = state.http_client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Todoist API failed: {}", e))?;

    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Todoist API error: {}", body));
    }

    let tasks: Vec<serde_json::Value> = res.json().await.map_err(|e| e.to_string())?;

    let simplified: Vec<_> = tasks.iter().map(|t| {
        json!({
            "id": t["id"],
            "content": t["content"],
            "description": t.get("description").unwrap_or(&json!("")),
            "due": t.get("due"),
            "priority": t.get("priority").unwrap_or(&json!(1)),
            "project_id": t.get("project_id"),
            "is_completed": t.get("is_completed").unwrap_or(&json!(false)),
        })
    }).collect();

    Ok(json!({"status": "success", "tasks": simplified, "count": simplified.len()}))
}

pub async fn create_task(
    state: &AppState,
    user_id: &str,
    params: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut cred = get_credential(state, user_id).await?;
    let token = get_valid_token(state, &mut cred).await?;

    let content = params["content"].as_str().ok_or("Missing task content")?;
    let description = params["description"].as_str().unwrap_or("");
    let due_string = params["due_string"].as_str().unwrap_or("");
    let priority = params["priority"].as_i64().unwrap_or(1);

    let mut body = json!({"content": content, "priority": priority});
    if !description.is_empty() {
        body["description"] = json!(description);
    }
    if !due_string.is_empty() {
        body["due_string"] = json!(due_string);
    }
    if let Some(project_id) = params["project_id"].as_str() {
        body["project_id"] = json!(project_id);
    }

    let res = state.http_client
        .post("https://api.todoist.com/rest/v2/tasks")
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Todoist create failed: {}", e))?;

    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Todoist create error: {}", body));
    }

    let task: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    Ok(json!({
        "status": "created",
        "task_id": task["id"],
        "content": content,
    }))
}

pub async fn update_task(
    state: &AppState,
    user_id: &str,
    params: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut cred = get_credential(state, user_id).await?;
    let token = get_valid_token(state, &mut cred).await?;

    let task_id = params["task_id"].as_str().ok_or("Missing task_id")?;

    let mut body = json!({});
    if let Some(c) = params["content"].as_str() { body["content"] = json!(c); }
    if let Some(d) = params["description"].as_str() { body["description"] = json!(d); }
    if let Some(ds) = params["due_string"].as_str() { body["due_string"] = json!(ds); }
    if let Some(p) = params["priority"].as_i64() { body["priority"] = json!(p); }

    let res = state.http_client
        .post(format!("https://api.todoist.com/rest/v2/tasks/{}", task_id))
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Todoist update failed: {}", e))?;

    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Todoist update error: {}", body));
    }

    Ok(json!({"status": "updated", "task_id": task_id}))
}

pub async fn complete_task(
    state: &AppState,
    user_id: &str,
    params: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut cred = get_credential(state, user_id).await?;
    let token = get_valid_token(state, &mut cred).await?;

    let task_id = params["task_id"].as_str().ok_or("Missing task_id")?;

    let res = state.http_client
        .post(format!("https://api.todoist.com/rest/v2/tasks/{}/close", task_id))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Todoist complete failed: {}", e))?;

    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Todoist complete error: {}", body));
    }

    Ok(json!({"status": "completed", "task_id": task_id}))
}
