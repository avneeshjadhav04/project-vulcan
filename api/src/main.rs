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
    if let Err(e) = run().await {
        eprintln!("FATAL: {}", e);
        std::process::exit(1);
    }
}

async fn run() -> anyhow::Result<()> {
    eprintln!("Carbon AI API starting...");

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "api=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    tracing::info!("Loading configuration...");
    let config = config::Config::from_env()?;
    tracing::info!("Configuration loaded successfully");

    tracing::info!("Initializing database...");
    let db_pool = db::init_db(&config).await?;
    tracing::info!("Database initialized successfully");

    let state = AppState {
        config: config.clone(),
        db: db_pool,
    };

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
        .layer(CorsLayer::permissive())
        .with_state(state);

    // Serve static files if dist/ exists (production mode)
    let app = if std::path::Path::new("./dist").exists() {
        tracing::info!("Serving static files from ./dist");
        Router::new()
            .nest("/api", api_routes)
            .nest_service("/", ServeDir::new("./dist").fallback(ServeFile::new("./dist/index.html")))
    } else {
        tracing::info!("Running in API-only mode");
        api_routes
    };

    let addr: SocketAddr = config.bind_addr.parse()?;
    tracing::info!("API listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn health_check() -> &'static str {
    "ok"
}
