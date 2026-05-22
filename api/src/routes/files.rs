use axum::{
    extract::{Multipart, Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{delete, post},
    Router,
};

use crate::{middleware::AppState, models::Claims};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/chats/:chat_id/files", post(upload_file).get(list_files))
        .route("/chats/:chat_id/files/:file_id", delete(delete_file).get(download_file))
}

async fn upload_file(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(chat_id): Path<String>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<serde_json::Value>), StatusCode> {
    // Verify chat belongs to user
    let chat_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM chats WHERE id = ?1 AND user_id = ?2)"
    )
    .bind(&chat_id)
    .bind(&claims.sub)
    .fetch_one(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if !chat_exists {
        return Err(StatusCode::NOT_FOUND);
    }

    let upload_dir = std::env::var("UPLOAD_DIR").unwrap_or_else(|_| "./uploads".to_string());
    let chat_dir = std::path::Path::new(&upload_dir).join(&chat_id);
    tokio::fs::create_dir_all(&chat_dir).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut uploaded_files = Vec::new();

    while let Some(field) = multipart.next_field().await.map_err(|_| StatusCode::BAD_REQUEST)? {
        let name = field.name().unwrap_or("unknown").to_string();
        if name != "file" {
            continue;
        }

        let raw_filename = field.file_name().unwrap_or("unnamed");
        // Sanitize filename to prevent path traversal and header injection
        let filename = std::path::Path::new(raw_filename)
            .file_name()
            .unwrap_or(std::ffi::OsStr::new("unnamed"))
            .to_string_lossy()
            .replace("\"", "")
            .replace("\r", "")
            .replace("\n", "");
        let content_type = field.content_type().unwrap_or("application/octet-stream").to_string();
        let data = field.bytes().await.map_err(|_| StatusCode::BAD_REQUEST)?;
        let size = data.len() as i64;

        // Size limit: 50MB
        if size > 50 * 1024 * 1024 {
            return Err(StatusCode::PAYLOAD_TOO_LARGE);
        }

        let file_id = uuid::Uuid::new_v4().to_string().replace("-", "");
        let ext = std::path::Path::new(&filename)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("bin");
        let storage_filename = format!("{}.{}", file_id, ext);
        let storage_path = chat_dir.join(&storage_filename);

        tokio::fs::write(&storage_path, &data).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        // Extract text from common file types
        let extracted_text = extract_text(&data, &content_type, &filename);

        let storage_path_str = storage_path.to_string_lossy().to_string();

        sqlx::query(
            "INSERT INTO files (chat_id, user_id, filename, mime_type, size_bytes, storage_path, extracted_text) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
        )
        .bind(&chat_id)
        .bind(&claims.sub)
        .bind(&filename)
        .bind(&content_type)
        .bind(size)
        .bind(&storage_path_str)
        .bind(extracted_text.as_deref())
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        uploaded_files.push(serde_json::json!({
            "id": file_id,
            "filename": filename,
            "mime_type": content_type,
            "size_bytes": size,
            "extracted": extracted_text.is_some(),
            "extracted_text": extracted_text,
        }));
    }

    Ok((StatusCode::CREATED, Json(serde_json::json!({ "files": uploaded_files }))))
}

async fn list_files(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(chat_id): Path<String>,
) -> Result<Json<Vec<serde_json::Value>>, StatusCode> {
    let files: Vec<crate::models::FileRecord> = sqlx::query_as(
        "SELECT * FROM files WHERE chat_id = ?1 AND user_id = ?2 ORDER BY created_at DESC"
    )
    .bind(&chat_id)
    .bind(&claims.sub)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let result: Vec<serde_json::Value> = files.into_iter().map(|f| {
        serde_json::json!({
            "id": f.id,
            "filename": f.filename,
            "mime_type": f.mime_type,
            "size_bytes": f.size_bytes,
            "extracted": f.extracted_text.is_some(),
            "created_at": f.created_at,
        })
    }).collect();

    Ok(Json(result))
}

async fn delete_file(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path((chat_id, file_id)): Path<(String, String)>,
) -> Result<StatusCode, StatusCode> {
    let file: Option<crate::models::FileRecord> = sqlx::query_as(
        "SELECT * FROM files WHERE id = ?1 AND chat_id = ?2 AND user_id = ?3"
    )
    .bind(&file_id)
    .bind(&chat_id)
    .bind(&claims.sub)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if let Some(f) = file {
        let _ = tokio::fs::remove_file(&f.storage_path).await;
        sqlx::query("DELETE FROM files WHERE id = ?1")
            .bind(&file_id)
            .execute(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

async fn download_file(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path((chat_id, file_id)): Path<(String, String)>,
) -> Result<impl IntoResponse, StatusCode> {
    let file: Option<crate::models::FileRecord> = sqlx::query_as(
        "SELECT * FROM files WHERE id = ?1 AND chat_id = ?2 AND user_id = ?3"
    )
    .bind(&file_id)
    .bind(&chat_id)
    .bind(&claims.sub)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if let Some(f) = file {
        let data = tokio::fs::read(&f.storage_path).await.map_err(|_| StatusCode::NOT_FOUND)?;
        
        // Return with content-type and content-disposition
        Ok((
            axum::http::HeaderMap::from_iter([
                (axum::http::header::CONTENT_TYPE, f.mime_type.parse().unwrap()),
                (axum::http::header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", f.filename).parse().unwrap()),
            ]),
            data,
        ))
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

fn extract_text(data: &[u8], mime_type: &str, filename: &str) -> Option<String> {
    match mime_type {
        "text/plain" | "text/markdown" | "text/x-markdown" => {
            String::from_utf8(data.to_vec()).ok()
        }
        "text/csv" => {
            String::from_utf8(data.to_vec()).ok()
        }
        "application/json" => {
            String::from_utf8(data.to_vec()).ok()
        }
        _ => {
            // For other types, try to detect by extension
            let ext = std::path::Path::new(filename)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("");
            match ext {
                "txt" | "md" | "rs" | "py" | "js" | "ts" | "jsx" | "tsx" | "json" | "csv" | "yaml" | "yml" | "toml" | "html" | "css" | "sh" | "sql" | "go" | "c" | "cpp" | "h" | "java" | "kt" | "swift" | "rb" | "php" | "xml" | "log" | "ini" | "cfg" | "conf" => {
                    String::from_utf8(data.to_vec()).ok()
                }
                _ => None,
            }
        }
    }
}
