use axum::{
    middleware::{from_fn, from_fn_with_state},
    routing::get,
    Router,
};
use std::net::SocketAddr;
use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
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

    let state = AppState {
        config: config.clone(),
        db: db_pool,
    };

    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::Any)
        .allow_methods([axum::http::Method::GET, axum::http::Method::POST, axum::http::Method::DELETE])
        .allow_headers([axum::http::header::CONTENT_TYPE, axum::http::header::COOKIE])
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
        .layer(cors)
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

async fn health_check() -> &'static str {
    "ok"
}
