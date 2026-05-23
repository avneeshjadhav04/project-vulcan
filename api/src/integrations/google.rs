use crate::{middleware::AppState, models::IntegrationCredential, oauth};
use serde_json::json;
use base64::Engine;

pub async fn google_oauth_config(state: &AppState, user_id: &str) -> Option<oauth::OAuthConfig> {
    let mut db_client_id = None;
    let mut db_client_secret = None;

    if let Ok(Some(config)) = sqlx::query_as::<_, crate::models::IntegrationConfig>(
        "SELECT * FROM integration_configs WHERE user_id = ? AND provider = 'google'"
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await {
        if let Ok(id) = oauth::decrypt_token(&config.encrypted_client_id, &state.config.master_key) {
            db_client_id = Some(id);
        }
        if let Ok(secret) = oauth::decrypt_token(&config.encrypted_client_secret, &state.config.master_key) {
            db_client_secret = Some(secret);
        }
    }

    let client_id = db_client_id.or_else(|| state.config.google_client_id.clone())?;
    let client_secret = db_client_secret.or_else(|| state.config.google_client_secret.clone())?;
    let redirect_uri = format!(
        "{}/api/integrations/google/callback",
        state.config.app_base_url
    );

    Some(oauth::OAuthConfig {
        client_id,
        client_secret,
        auth_url: "https://accounts.google.com/o/oauth2/v2/auth".to_string(),
        token_url: "https://oauth2.googleapis.com/token".to_string(),
        redirect_uri,
        scopes: vec![
            "https://www.googleapis.com/auth/calendar".to_string(),
            "https://www.googleapis.com/auth/calendar.events".to_string(),
            "https://www.googleapis.com/auth/gmail.send".to_string(),
            "https://www.googleapis.com/auth/gmail.readonly".to_string(),
        ],
    })
}

pub async fn get_valid_token(
    state: &AppState,
    credential: &mut IntegrationCredential,
) -> Result<String, String> {
    let config = google_oauth_config(state, &credential.user_id).await.ok_or("Google OAuth not configured")?;

    if oauth::is_token_expired(&credential.expires_at) {
        let refresh_token = credential
            .encrypted_refresh_token
            .as_ref()
            .ok_or("No refresh token available")?;

        let rt = oauth::decrypt_token(refresh_token, &state.config.master_key)?;
        let new_token = oauth::refresh_access_token(&state.http_client, &config, &rt).await?;

        credential.encrypted_access_token =
            oauth::encrypt_token(&new_token.access_token, &state.config.master_key)?;
        if let Some(ref rt2) = new_token.refresh_token {
            credential.encrypted_refresh_token =
                Some(oauth::encrypt_token(rt2, &state.config.master_key)?);
        }
        credential.expires_at = oauth::compute_expiry(new_token.expires_in);

        sqlx::query(
            "UPDATE integration_credentials SET encrypted_access_token = ?1, encrypted_refresh_token = COALESCE(?2, encrypted_refresh_token), expires_at = ?3, updated_at = datetime('now') WHERE id = ?4"
        )
        .bind(&credential.encrypted_access_token)
        .bind(credential.encrypted_refresh_token.as_deref())
        .bind(&credential.expires_at)
        .bind(&credential.id)
        .execute(&state.db)
        .await
        .map_err(|e| format!("Failed to update token: {}", e))?;
    }

    oauth::decrypt_token(&credential.encrypted_access_token, &state.config.master_key)
}

// ─── Calendar APIs ───

pub async fn list_calendar_events(
    state: &AppState,
    user_id: &str,
    params: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut cred = get_credential(state, user_id, "google").await?;
    let token = get_valid_token(state, &mut cred).await?;

    let time_min = params["time_min"].as_str().unwrap_or("");
    let time_max = params["time_max"].as_str().unwrap_or("");
    let max_results = params["max_results"].as_i64().unwrap_or(10);

    let mut url = "https://www.googleapis.com/calendar/v3/calendars/primary/events".to_string();
    let mut query_parts = vec![format!("maxResults={}", max_results)];
    if !time_min.is_empty() {
        query_parts.push(format!("timeMin={}", urlencoding::encode(time_min)));
    }
    if !time_max.is_empty() {
        query_parts.push(format!("timeMax={}", urlencoding::encode(time_max)));
    }
    url = format!("{}?{}", url, query_parts.join("&"));

    let res = state
        .http_client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Calendar API failed: {}", e))?;

    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Calendar API error: {}", body));
    }

    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    let events = data["items"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|e| {
                    json!({
                        "id": e["id"],
                        "summary": e["summary"],
                        "start": e["start"],
                        "end": e["end"],
                        "location": e["location"],
                        "description": e.get("description"),
                        "attendees": e.get("attendees"),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(json!({"status": "success", "events": events, "count": events.len()}))
}

pub async fn create_calendar_event(
    state: &AppState,
    user_id: &str,
    params: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut cred = get_credential(state, user_id, "google").await?;
    let token = get_valid_token(state, &mut cred).await?;

    let summary = params["summary"].as_str().ok_or("Missing summary")?;
    let start_time = params["start_time"]
        .as_str()
        .ok_or("Missing start_time (ISO 8601)")?;
    let end_time = params["end_time"]
        .as_str()
        .ok_or("Missing end_time (ISO 8601)")?;

    let body = json!({
        "summary": summary,
        "start": {"dateTime": start_time, "timeZone": params["timezone"].as_str().unwrap_or("UTC")},
        "end": {"dateTime": end_time, "timeZone": params["timezone"].as_str().unwrap_or("UTC")},
        "description": params["description"].as_str().unwrap_or(""),
        "location": params["location"].as_str().unwrap_or(""),
    });

    let res = state
        .http_client
        .post("https://www.googleapis.com/calendar/v3/calendars/primary/events")
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Calendar create failed: {}", e))?;

    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Calendar create error: {}", body));
    }

    let event: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    Ok(json!({
        "status": "created",
        "event_id": event["id"],
        "summary": summary,
        "start": start_time,
        "end": end_time,
    }))
}

pub async fn delete_calendar_event(
    state: &AppState,
    user_id: &str,
    params: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut cred = get_credential(state, user_id, "google").await?;
    let token = get_valid_token(state, &mut cred).await?;

    let event_id = params["event_id"].as_str().ok_or("Missing event_id")?;

    let url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events/{}",
        urlencoding::encode(event_id)
    );
    let res = state
        .http_client
        .delete(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Calendar delete failed: {}", e))?;

    let status = res.status();
    if status.is_success() || status.as_u16() == 204 {
        Ok(json!({"status": "deleted", "event_id": event_id}))
    } else {
        let body = res.text().await.unwrap_or_default();
        Err(format!("Calendar delete error ({}): {}", status, body))
    }
}

// ─── Gmail APIs ───

pub async fn send_email(
    state: &AppState,
    user_id: &str,
    params: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut cred = get_credential(state, user_id, "google").await?;
    let token = get_valid_token(state, &mut cred).await?;

    let to = params["to"].as_str().ok_or("Missing recipient (to)")?;
    let subject = params["subject"].as_str().ok_or("Missing subject")?;
    let body_text = params["body"].as_str().ok_or("Missing body")?;

    let email = format!(
        "From: me\r\nTo: {}\r\nSubject: {}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{}",
        to, subject, body_text
    );
    let encoded =
        base64::engine::general_purpose::URL_SAFE.encode(email.as_bytes());

    let gmail_body = json!({"raw": encoded});

    let res = state
        .http_client
        .post("https://gmail.googleapis.com/gmail/v1/users/me/messages/send")
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .json(&gmail_body)
        .send()
        .await
        .map_err(|e| format!("Gmail send failed: {}", e))?;

    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Gmail send error: {}", body));
    }

    Ok(json!({"status": "sent", "to": to, "subject": subject}))
}

pub async fn list_emails(
    state: &AppState,
    user_id: &str,
    params: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut cred = get_credential(state, user_id, "google").await?;
    let token = get_valid_token(state, &mut cred).await?;

    let max_results = params["max_results"].as_i64().unwrap_or(5);
    let query = params["query"].as_str().unwrap_or("");

    let url = if query.is_empty() {
        format!(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults={}",
            max_results
        )
    } else {
        format!(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults={}&q={}",
            max_results,
            urlencoding::encode(query)
        )
    };

    let res = state
        .http_client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Gmail list failed: {}", e))?;

    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Gmail list error: {}", body));
    }

    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let messages = data["messages"].as_array();

    let mut results = Vec::new();
    if let Some(msgs) = messages {
        for msg in msgs.iter().take(5) {
            if let Some(mid) = msg["id"].as_str() {
                match state.http_client
                    .get(format!("https://gmail.googleapis.com/gmail/v1/users/me/messages/{}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date", mid))
                    .header("Authorization", format!("Bearer {}", token))
                    .send()
                    .await
                {
                    Ok(detail_res) => {
                        if let Ok(detail) = detail_res.json::<serde_json::Value>().await {
                            let headers = &detail["payload"]["headers"];
                            let from = headers.as_array().and_then(|h| h.iter().find(|h| h["name"] == "From")).and_then(|h| h["value"].as_str()).unwrap_or("Unknown");
                            let subject = headers.as_array().and_then(|h| h.iter().find(|h| h["name"] == "Subject")).and_then(|h| h["value"].as_str()).unwrap_or("No subject");
                            let snippet = detail["snippet"].as_str().unwrap_or("");
                            results.push(json!({
                                "id": mid,
                                "from": from,
                                "subject": subject,
                                "snippet": snippet,
                            }));
                        }
                    }
                    Err(e) => tracing::warn!("Failed to fetch email detail {}: {}", mid, e),
                }
            }
        }
    }

    Ok(json!({"status": "success", "emails": results, "count": results.len()}))
}

pub async fn read_email(
    state: &AppState,
    user_id: &str,
    params: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut cred = get_credential(state, user_id, "google").await?;
    let token = get_valid_token(state, &mut cred).await?;

    let email_id = params["email_id"].as_str().ok_or("Missing email_id")?;

    let res = state
        .http_client
        .get(format!(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/{}?format=full",
            email_id
        ))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Gmail read failed: {}", e))?;

    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Gmail read error: {}", body));
    }

    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    let headers = &data["payload"]["headers"];
    let from = get_header(headers, "From");
    let subject = get_header(headers, "Subject");
    let date = get_header(headers, "Date");

    let body_str = extract_email_body(&data["payload"]);

    Ok(json!({
        "status": "success",
        "id": data["id"],
        "from": from,
        "subject": subject,
        "date": date,
        "body": body_str,
    }))
}

fn get_header(headers: &serde_json::Value, name: &str) -> String {
    headers
        .as_array()
        .and_then(|h| h.iter().find(|h| h["name"] == name))
        .and_then(|h| h["value"].as_str())
        .unwrap_or("")
        .to_string()
}

fn extract_email_body(payload: &serde_json::Value) -> String {
    if let Some(body_data) = payload["body"]["data"].as_str() {
        if let Ok(decoded) = base64::engine::general_purpose::URL_SAFE.decode(body_data)
        .or_else(|_| {
            base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(body_data)
        }) {
            if let Ok(s) = String::from_utf8(decoded) {
                return s;
            }
        }
    }

    // Try multipart
    if let Some(parts) = payload["parts"].as_array() {
        for part in parts {
            let mime = part["mimeType"].as_str().unwrap_or("");
            if mime == "text/plain" || mime == "text/html" {
                let body_str = extract_email_body(part);
                if !body_str.is_empty() {
                    return body_str;
                }
            }
        }
    }

    String::new()
}

async fn get_credential(
    state: &AppState,
    user_id: &str,
    provider: &str,
) -> Result<IntegrationCredential, String> {
    sqlx::query_as::<_, IntegrationCredential>(
        "SELECT * FROM integration_credentials WHERE user_id = ?1 AND provider = ?2",
    )
    .bind(user_id)
    .bind(provider)
    .fetch_one(&state.db)
    .await
    .map_err(|_| format!("{} not connected. Go to Settings to connect.", provider))
}
