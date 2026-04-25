use anyhow::Result;
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

    // Try the configured location first
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

    // Fallback 1: Try without the /data prefix (disk might not be mounted)
    let fallback1 = "sqlite:carbon_ai.db".to_string();
    println!("[DB] Trying fallback location: {}", fallback1);
    match try_connect(&fallback1).await {
        Ok(pool) => {
            println!("[DB] Connected successfully at fallback location (./carbon_ai.db)");
            println!("[DB] WARNING: Data will be lost on redeploy. Add a Render Disk at /data for persistence.");
            run_migrations(&pool).await?;
            seed_admin(&pool, config).await?;
            return Ok(pool);
        }
        Err(e) => {
            println!("[DB] Fallback 1 failed: {}", e);
        }
    }

    // Fallback 2: In-memory database (always works, but completely ephemeral)
    let fallback2 = "sqlite::memory:".to_string();
    println!("[DB] Trying in-memory database (all data will be lost on restart)");
    let pool = SqlitePool::connect(&fallback2).await?;
    println!("[DB] Connected to in-memory database");
    run_migrations(&pool).await?;
    seed_admin(&pool, config).await?;
    Ok(pool)
}

async fn try_connect(database_url: &str) -> Result<SqlitePool> {
    // Ensure parent directory exists and is writable
    if let Some(path) = database_url.strip_prefix("sqlite:") {
        if path != ":memory:" && !path.is_empty() {
            let parent = Path::new(path).parent();
            if let Some(p) = parent {
                if !p.exists() {
                    println!("[DB] Creating directory: {}", p.display());
                    std::fs::create_dir_all(p)?;
                }
                // Try to make it writable
                let _ = std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o777));
            }
            // Also try to ensure the file itself doesn't exist with bad permissions
            if Path::new(path).exists() {
                let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o666));
            }
        }
    }

    let pool = SqlitePool::connect(database_url).await?;
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
