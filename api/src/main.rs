use axum::{
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    middleware::{from_fn, from_fn_with_state},
    routing::get,
    Router,
};
use std::net::SocketAddr;
use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod auth;
mod config;
mod db;
mod middleware;
mod models;
mod routes;

use middleware::{admin_middleware, auth_middleware, AppState};

#[tokio::main]
async fn main() {
    println!("========================================");
    println!("  Carbon AI Assistant - API Starting");
    println!("========================================");

    if let Err(e) = run().await {
        println!("[FATAL] Application failed to start: {}", e);
        std::process::exit(1);
    }
}

async fn run() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "api=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer().with_ansi(false))
        .init();

    println!("[INIT] Loading configuration...");
    let config = config::Config::from_env()?;
    println!("[INIT] Configuration loaded");

    println!("[INIT] Initializing database...");
    let db_pool = db::init_db(&config).await?;
    println!("[INIT] Database ready");

    // Load RSA public key at startup if available
    let jwt_public_key = config.jwt_secret_path.as_ref().and_then(|path| {
        let pub_path = format!("{}.pub", path);
        if std::path::Path::new(&pub_path).exists() {
            match std::fs::read(&pub_path) {
                Ok(key) => {
                    println!("[INIT] Loaded RSA public key from {}", pub_path);
                    Some(key)
                }
                Err(e) => {
                    println!("[INIT] Failed to read RSA public key: {}", e);
                    None
                }
            }
        } else {
            println!("[INIT] No RSA public key found, using HS256 fallback");
            None
        }
    });

    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()?;

    let state = AppState {
        config: config.clone(),
        db: db_pool,
        http_client,
        jwt_public_key,
    };

    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::AllowOrigin::mirror_request())
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::DELETE,
            axum::http::Method::PATCH,
        ])
        .allow_headers([axum::http::header::CONTENT_TYPE, axum::http::header::COOKIE, axum::http::header::AUTHORIZATION])
        .allow_credentials(true);

    let api_routes = Router::new()
        .route("/health", get(health_check))
        .merge(routes::auth::router())
        .merge(
            routes::chat::router()
                .layer(from_fn_with_state(state.clone(), auth_middleware)),
        )
        .merge(
            routes::models::router()
                .layer(from_fn_with_state(state.clone(), auth_middleware)),
        )
        .merge(
            routes::terminal::router()
                .layer(from_fn_with_state(state.clone(), auth_middleware)),
        )
        .merge(
            routes::admin::router()
                .layer(from_fn(admin_middleware))
                .layer(from_fn_with_state(state.clone(), auth_middleware)),
        )
        .layer(DefaultBodyLimit::max(1024 * 1024)) // 1MB body limit
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Serve static files if dist/ exists (production mode)
    let app = if std::path::Path::new("./dist").exists() {
        println!("[INIT] Serving static frontend from ./dist");
        Router::new()
            .nest("/api", api_routes)
            .nest_service("/", ServeDir::new("./dist").fallback(ServeFile::new("./dist/index.html")))
    } else {
        println!("[INIT] Running in API-only mode (no dist/ found)");
        api_routes
    };

    let addr: SocketAddr = config.bind_addr.parse()?;
    println!("[INIT] Binding to {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("[INIT] Server starting...");
    axum::serve(listener, app).await?;

    Ok(())
}

async fn health_check(State(state): State<AppState>) -> Result<&'static str, StatusCode> {
    sqlx::query_as::<_, (i32,)>("SELECT 1")
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    Ok("ok")
}
