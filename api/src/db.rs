use anyhow::{Result, bail};
use sqlx::SqlitePool;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use crate::config::Config;
use crate::models::User;

pub async fn init_db(config: &Config) -> Result<SqlitePool> {
    let database_url = if config.database_url.starts_with("sqlite:") {
        config.database_url.clone()
    } else {
        format!("sqlite:{}", config.database_url)
    };

    println!("[DB] Attempting to connect to SQLite database at: {}", database_url);

    match try_connect(&database_url).await {
        Ok(pool) => {
            println!("[DB] Connected successfully at configured location");
            run_migrations(&pool).await?;
            seed_admin(&pool, config).await?;
            return Ok(pool);
        }
        Err(e) => {
            println!("[DB] Failed to open at configured location: {}", e);
        }
    }

    // Fallback: Try without the /data prefix (disk might not be mounted)
    let fallback = "sqlite:carbon_ai.db".to_string();
    println!("[DB] Trying fallback location: {}", fallback);
    match try_connect(&fallback).await {
        Ok(pool) => {
            println!("[DB] Connected successfully at fallback location (./carbon_ai.db)");
            println!("[DB] WARNING: Data will be lost on redeploy. Add a Render Disk at /data for persistence.");
            run_migrations(&pool).await?;
            seed_admin(&pool, config).await?;
            return Ok(pool);
        }
        Err(e) => {
            bail!("Failed to open SQLite database at any location: {}", e);
        }
    }
}

async fn try_connect(database_url: &str) -> Result<SqlitePool> {
    if let Some(path) = database_url.strip_prefix("sqlite:") {
        if path != ":memory:" && !path.is_empty() {
            let parent = Path::new(path).parent();
            if let Some(p) = parent {
                if !p.exists() {
                    println!("[DB] Creating directory: {}", p.display());
                    std::fs::create_dir_all(p)?;
                }
                let _ = std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o755));
            }
            if Path::new(path).exists() {
                let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o640));
            }
        }
    }

    let pool = SqlitePool::connect(database_url).await?;

    // Enable foreign keys and WAL mode for every connection
    sqlx::query("PRAGMA foreign_keys = ON").execute(&pool).await?;
    sqlx::query("PRAGMA journal_mode = WAL").execute(&pool).await?;

    Ok(pool)
}

async fn run_migrations(pool: &SqlitePool) -> Result<()> {
    println!("[DB] Running migrations...");
    sqlx::migrate!("../db/migrations").run(pool).await?;
    println!("[DB] Migrations complete");
    Ok(())
}

async fn seed_admin(pool: &SqlitePool, config: &Config) -> Result<()> {
    let existing = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = ?1")
        .bind(&config.admin_default_email)
        .fetch_optional(pool)
        .await?;

    if existing.is_none() {
        let hash = crate::auth::hash_password(&config.admin_default_password)?;
        sqlx::query(
            "INSERT INTO users (email, password_hash, role) VALUES (?1, ?2, 'admin')",
        )
        .bind(&config.admin_default_email)
        .bind(&hash)
        .execute(pool)
        .await?;
        println!("[DB] Created default admin user: {}", config.admin_default_email);
    }

    Ok(())
}
