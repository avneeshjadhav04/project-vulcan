use axum::{
    extract::{Multipart, Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{delete, get, post},
    Router,
};

use calamine::Reader;
use crate::{middleware::AppState, models::Claims};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/chats/:chat_id/files", post(upload_file).get(list_files))
        .route(
            "/chats/:chat_id/files/:file_id",
            delete(delete_file).get(download_file),
        )
        .route(
            "/chats/:chat_id/workspace",
            get(list_workspace_files),
        )
        .route(
            "/chats/:chat_id/workspace/*filename",
            get(download_workspace_file),
        )
        .route("/workspace", get(list_user_workspace))
        .route("/workspace/folder", post(create_folder))
        .route("/workspace/file", post(create_file))
        .route(
            "/workspace/*filename",
            get(download_user_workspace)
                .put(save_user_workspace)
                .delete(delete_user_workspace)
                .patch(rename_user_workspace),
        )
}

async fn upload_file(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(chat_id): Path<String>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<serde_json::Value>), StatusCode> {
    // Verify chat belongs to user
    let chat_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM chats WHERE id = ?1 AND user_id = ?2)")
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
    tokio::fs::create_dir_all(&chat_dir)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut uploaded_files = Vec::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)?
    {
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
        let content_type = field
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_string();
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

        tokio::fs::write(&storage_path, &data)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

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

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "files": uploaded_files })),
    ))
}

async fn list_files(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(chat_id): Path<String>,
) -> Result<Json<Vec<serde_json::Value>>, StatusCode> {
    let files: Vec<crate::models::FileRecord> = sqlx::query_as(
        "SELECT * FROM files WHERE chat_id = ?1 AND user_id = ?2 ORDER BY created_at DESC",
    )
    .bind(&chat_id)
    .bind(&claims.sub)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let result: Vec<serde_json::Value> = files
        .into_iter()
        .map(|f| {
            serde_json::json!({
                "id": f.id,
                "filename": f.filename,
                "mime_type": f.mime_type,
                "size_bytes": f.size_bytes,
                "extracted": f.extracted_text.is_some(),
                "created_at": f.created_at,
            })
        })
        .collect();

    Ok(Json(result))
}

async fn delete_file(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path((chat_id, file_id)): Path<(String, String)>,
) -> Result<StatusCode, StatusCode> {
    let file: Option<crate::models::FileRecord> =
        sqlx::query_as("SELECT * FROM files WHERE id = ?1 AND chat_id = ?2 AND user_id = ?3")
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
    let file: Option<crate::models::FileRecord> =
        sqlx::query_as("SELECT * FROM files WHERE id = ?1 AND chat_id = ?2 AND user_id = ?3")
            .bind(&file_id)
            .bind(&chat_id)
            .bind(&claims.sub)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if let Some(f) = file {
        // Prevent path traversal by ensuring the resolved path is within the upload directory
        let upload_dir = std::env::var("UPLOAD_DIR").unwrap_or_else(|_| "./uploads".to_string());
        let abs_upload_dir = std::path::Path::new(&upload_dir).canonicalize().unwrap_or_else(|_| std::path::Path::new(&upload_dir).to_path_buf());
        let abs_storage_path = std::path::Path::new(&f.storage_path).canonicalize().unwrap_or_else(|_| std::path::Path::new(&f.storage_path).to_path_buf());
        if !abs_storage_path.starts_with(&abs_upload_dir) {
            tracing::error!("Path traversal attempt blocked: {} outside {}", abs_storage_path.display(), abs_upload_dir.display());
            return Err(StatusCode::FORBIDDEN);
        }

        let data = tokio::fs::read(&f.storage_path)
            .await
            .map_err(|_| StatusCode::NOT_FOUND)?;

        // Return with content-type and content-disposition
        Ok((
            axum::http::HeaderMap::from_iter([
                (
                    axum::http::header::CONTENT_TYPE,
                    f.mime_type.parse().unwrap(),
                ),
                (
                    axum::http::header::CONTENT_DISPOSITION,
                    format!("attachment; filename=\"{}\"", f.filename)
                        .parse()
                        .unwrap(),
                ),
            ]),
            data,
        ))
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

fn extract_text(data: &[u8], mime_type: &str, filename: &str) -> Option<String> {
    // First, try MIME type detection
    match mime_type {
        "text/plain" | "text/markdown" | "text/x-markdown" => String::from_utf8(data.to_vec()).ok(),
        "text/csv" => String::from_utf8(data.to_vec()).ok(),
        "application/json" => String::from_utf8(data.to_vec()).ok(),
        "application/pdf" => extract_pdf_text(data),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => extract_docx_text(data),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => extract_xlsx_text(data),
        "application/vnd.ms-excel" => extract_xlsx_text(data),
        _ => {
            // For other types, try to detect by extension
            let ext = std::path::Path::new(filename)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            match ext.as_str() {
                "txt" | "md" | "rs" | "py" | "js" | "ts" | "jsx" | "tsx" | "json" | "csv"
                | "yaml" | "yml" | "toml" | "html" | "css" | "sh" | "sql" | "go" | "c" | "cpp"
                | "h" | "java" | "kt" | "swift" | "rb" | "php" | "xml" | "log" | "ini" | "cfg"
                | "conf" => String::from_utf8(data.to_vec()).ok(),
                "pdf" => extract_pdf_text(data),
                "docx" => extract_docx_text(data),
                "xlsx" | "xls" => extract_xlsx_text(data),
                _ => None,
            }
        }
    }
}

fn extract_pdf_text(data: &[u8]) -> Option<String> {
    match lopdf::Document::load_mem(data) {
        Ok(doc) => {
            let mut text = String::new();
            for (i, page) in doc.get_pages().iter().enumerate() {
                if let Ok(page_text) = doc.extract_text(&[*page.0]) {
                    if i > 0 {
                        text.push('\n');
                    }
                    text.push_str(&page_text);
                }
            }
            if text.trim().is_empty() {
                None
            } else {
                Some(text)
            }
        }
        Err(e) => {
            tracing::warn!("PDF extraction failed: {}", e);
            None
        }
    }
}

fn extract_docx_text(data: &[u8]) -> Option<String> {
    let cursor = std::io::Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor).ok()?;
    
    // Read word/document.xml from the DOCX archive
    let mut doc_xml = String::new();
    {
        let mut file = archive.by_name("word/document.xml").ok()?;
        std::io::Read::read_to_string(&mut file, &mut doc_xml).ok()?;
    }
    
    // Use xml-rs to parse the XML properly
    let mut text = String::new();
    let mut current_paragraph = String::new();
    let mut in_text_element = false;
    
    let reader = xml::reader::EventReader::from_str(&doc_xml);
    
    for event in reader {
        match event {
            Ok(xml::reader::XmlEvent::StartElement { name, .. }) => {
                if name.local_name == "t" && name.namespace.as_deref().unwrap_or("").contains("w") {
                    in_text_element = true;
                }
            }
            Ok(xml::reader::XmlEvent::EndElement { name }) => {
                if name.local_name == "t" && name.namespace.as_deref().unwrap_or("").contains("w") {
                    in_text_element = false;
                } else if name.local_name == "p" && name.namespace.as_deref().unwrap_or("").contains("w") {
                    // End of paragraph
                    if !current_paragraph.is_empty() {
                        if !text.is_empty() {
                            text.push('\n');
                        }
                        text.push_str(&current_paragraph);
                        current_paragraph.clear();
                    }
                }
            }
            Ok(xml::reader::XmlEvent::Characters(content)) => {
                if in_text_element {
                    current_paragraph.push_str(&content);
                }
            }
            _ => {}
        }
    }
    
    // Don't forget the last paragraph if it wasn't ended
    if !current_paragraph.is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&current_paragraph);
    }
    
    if text.trim().is_empty() {
        None
    } else {
        Some(text.trim().to_string())
    }
}

fn extract_xlsx_text(data: &[u8]) -> Option<String> {
    let cursor = std::io::Cursor::new(data);
    let mut workbook = calamine::Xlsx::new(cursor).ok()?;
    
    let mut text = String::new();
    if let Some(Ok(range)) = workbook.worksheet_range_at(0) {
        let rows = range.rows();
        for row in rows {
            let row_text: Vec<String> = row
                .iter()
                .map(|cell| cell.to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if !row_text.is_empty() {
                if !text.is_empty() {
                    text.push('\n');
                }
                text.push_str(&row_text.join("\t"));
            }
        }
    }
    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
}

// ─── Workspace CRUD helpers ───

fn is_safe_path(path: &str) -> bool {
    if path.is_empty() || path.starts_with('/') {
        return false;
    }
    !path.split('/').any(|c| c == "..")
}

fn resolve_workspace_path(workspace_dir: &std::path::Path, relative_path: &str) -> std::path::PathBuf {
    let safe = relative_path.trim_start_matches('/');
    workspace_dir.join(safe)
}

#[derive(serde::Deserialize)]
struct CreateFolderRequest {
    path: String,
}

#[derive(serde::Deserialize)]
struct CreateFileRequest {
    path: String,
}

#[derive(serde::Deserialize)]
struct SaveFileRequest {
    content: String,
}

#[derive(serde::Deserialize)]
struct RenameRequest {
    new_path: String,
}

async fn create_folder(
    _state: State<AppState>,
    claims: axum::Extension<Claims>,
    Json(req): Json<CreateFolderRequest>,
) -> Result<StatusCode, StatusCode> {
    if !is_safe_path(&req.path) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let workspace_dir = std::env::var("WORKSPACE_DIR").unwrap_or_else(|_| "./workspace".to_string());
    let user_workspace_dir = std::path::Path::new(&workspace_dir).join(&claims.sub);
    tokio::fs::create_dir_all(&user_workspace_dir)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let target_path = resolve_workspace_path(&user_workspace_dir, &req.path);
    tokio::fs::create_dir_all(&target_path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::CREATED)
}

async fn create_file(
    _state: State<AppState>,
    claims: axum::Extension<Claims>,
    Json(req): Json<CreateFileRequest>,
) -> Result<StatusCode, StatusCode> {
    if !is_safe_path(&req.path) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let workspace_dir = std::env::var("WORKSPACE_DIR").unwrap_or_else(|_| "./workspace".to_string());
    let user_workspace_dir = std::path::Path::new(&workspace_dir).join(&claims.sub);
    tokio::fs::create_dir_all(&user_workspace_dir)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let target_path = resolve_workspace_path(&user_workspace_dir, &req.path);
    if let Some(parent) = target_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    tokio::fs::write(&target_path, "")
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::CREATED)
}

async fn save_user_workspace(
    _state: State<AppState>,
    claims: axum::Extension<Claims>,
    Path(filename): Path<String>,
    Json(req): Json<SaveFileRequest>,
) -> Result<StatusCode, StatusCode> {
    if !is_safe_path(&filename) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let workspace_dir = std::env::var("WORKSPACE_DIR").unwrap_or_else(|_| "./workspace".to_string());
    let user_workspace_dir = std::path::Path::new(&workspace_dir).join(&claims.sub);
    let file_path = resolve_workspace_path(&user_workspace_dir, &filename);
    tokio::fs::write(&file_path, &req.content)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::OK)
}

async fn delete_user_workspace(
    _state: State<AppState>,
    claims: axum::Extension<Claims>,
    Path(filename): Path<String>,
) -> Result<StatusCode, StatusCode> {
    if !is_safe_path(&filename) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let workspace_dir = std::env::var("WORKSPACE_DIR").unwrap_or_else(|_| "./workspace".to_string());
    let user_workspace_dir = std::path::Path::new(&workspace_dir).join(&claims.sub);
    let target_path = resolve_workspace_path(&user_workspace_dir, &filename);
    let metadata = tokio::fs::metadata(&target_path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    if metadata.is_dir() {
        tokio::fs::remove_dir_all(&target_path)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    } else {
        tokio::fs::remove_file(&target_path)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn rename_user_workspace(
    _state: State<AppState>,
    claims: axum::Extension<Claims>,
    Path(filename): Path<String>,
    Json(req): Json<RenameRequest>,
) -> Result<StatusCode, StatusCode> {
    if !is_safe_path(&filename) || !is_safe_path(&req.new_path) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let workspace_dir = std::env::var("WORKSPACE_DIR").unwrap_or_else(|_| "./workspace".to_string());
    let user_workspace_dir = std::path::Path::new(&workspace_dir).join(&claims.sub);
    let old_path = resolve_workspace_path(&user_workspace_dir, &filename);
    let new_path = resolve_workspace_path(&user_workspace_dir, &req.new_path);
    tokio::fs::rename(&old_path, &new_path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::OK)
}

#[derive(serde::Serialize)]
struct WorkspaceFile {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<WorkspaceFile>>,
}

fn build_file_tree(dir: &std::path::Path, base: &std::path::Path) -> std::io::Result<Vec<WorkspaceFile>> {
    let mut files = Vec::new();
    if dir.is_dir() {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            let is_dir = path.is_dir();
            let rel_path = path.strip_prefix(base).unwrap_or(&path).to_string_lossy().into_owned().replace('\\', "/");
            let children = if is_dir {
                Some(build_file_tree(&path, base)?)
            } else {
                None
            };
            files.push(WorkspaceFile {
                name,
                path: rel_path,
                is_dir,
                children,
            });
        }
    }
    files.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(files)
}

async fn list_workspace_files(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(chat_id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let chat_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM chats WHERE id = ?1 AND user_id = ?2)")
            .bind(&chat_id)
            .bind(&claims.sub)
            .fetch_one(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if !chat_exists {
        return Err(StatusCode::NOT_FOUND);
    }

    let workspace_dir = std::env::var("WORKSPACE_DIR").unwrap_or_else(|_| "./workspace".to_string());
    let chat_workspace_dir = std::path::Path::new(&workspace_dir).join(&chat_id);
    
    if !chat_workspace_dir.exists() {
        return Ok(Json(serde_json::json!({ "files": [] })));
    }

    let files = tokio::task::spawn_blocking(move || build_file_tree(&chat_workspace_dir, &chat_workspace_dir))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(serde_json::json!({ "files": files })))
}

async fn list_user_workspace(
    State(_state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<impl IntoResponse, StatusCode> {
    let workspace_dir = std::env::var("WORKSPACE_DIR").unwrap_or_else(|_| "./workspace".to_string());
    let user_workspace_dir = std::path::Path::new(&workspace_dir).join(&claims.sub);
    
    if !user_workspace_dir.exists() {
        return Ok(Json(serde_json::json!({ "files": [] })));
    }

    let files = tokio::task::spawn_blocking(move || build_file_tree(&user_workspace_dir, &user_workspace_dir))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(serde_json::json!({ "files": files })))
}

async fn download_workspace_file(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path((chat_id, filename)): Path<(String, String)>,
) -> Result<impl IntoResponse, StatusCode> {
    // Verify chat belongs to user
    let chat_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM chats WHERE id = ?1 AND user_id = ?2)")
            .bind(&chat_id)
            .bind(&claims.sub)
            .fetch_one(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if !chat_exists {
        return Err(StatusCode::NOT_FOUND);
    }

    let workspace_dir = std::env::var("WORKSPACE_DIR").unwrap_or_else(|_| "./workspace".to_string());
    let chat_workspace_dir = std::path::Path::new(&workspace_dir).join(&chat_id);
    
    // Prevent path traversal
    if filename.contains("..") {
        return Err(StatusCode::BAD_REQUEST);
    }
    let safe_filename = filename.trim_start_matches('/');
    let file_path = chat_workspace_dir.join(safe_filename);

    let data = tokio::fs::read(&file_path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let mime_type = match ext {
        "txt" | "py" | "rs" | "js" | "ts" | "go" | "c" | "cpp" | "java" | "sh" | "md" | "yml" | "yaml" => "text/plain",
        "csv" => "text/csv",
        "json" => "application/json",
        "html" => "text/html",
        "css" => "text/css",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    };

    let display_filename = std::path::Path::new(&safe_filename).file_name().and_then(|f| f.to_str()).unwrap_or(safe_filename);

    Ok((
        axum::http::HeaderMap::from_iter([
            (
                axum::http::header::CONTENT_TYPE,
                mime_type.parse().unwrap(),
            ),
            (
                axum::http::header::CONTENT_DISPOSITION,
                format!("inline; filename=\"{}\"", display_filename)
                    .parse()
                    .unwrap(),
            ),
        ]),
        data,
    ))
}

async fn download_user_workspace(
    State(_state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(filename): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let workspace_dir = std::env::var("WORKSPACE_DIR").unwrap_or_else(|_| "./workspace".to_string());
    let user_workspace_dir = std::path::Path::new(&workspace_dir).join(&claims.sub);
    
    if filename.contains("..") {
        return Err(StatusCode::BAD_REQUEST);
    }
    let safe_filename = filename.trim_start_matches('/');
    let file_path = user_workspace_dir.join(safe_filename);

    let data = tokio::fs::read(&file_path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let mime_type = match ext {
        "txt" | "py" | "rs" | "js" | "ts" | "go" | "c" | "cpp" | "java" | "sh" | "md" | "yml" | "yaml" => "text/plain",
        "csv" => "text/csv",
        "json" => "application/json",
        "html" => "text/html",
        "css" => "text/css",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    };

    let display_filename = std::path::Path::new(&safe_filename).file_name().and_then(|f| f.to_str()).unwrap_or(safe_filename);

    Ok((
        axum::http::HeaderMap::from_iter([
            (
                axum::http::header::CONTENT_TYPE,
                mime_type.parse().unwrap(),
            ),
            (
                axum::http::header::CONTENT_DISPOSITION,
                format!("inline; filename=\"{}\"", display_filename)
                    .parse()
                    .unwrap(),
            ),
        ]),
        data,
    ))
}
