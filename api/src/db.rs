use anyhow::{Result, bail};
use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::Path;
use std::str::FromStr;

use crate::config::Config;
use crate::models::User;

fn normalize_sqlite_url(url: &str) -> String {
    // sqlx expects sqlite:///absolute/path or sqlite:relative/path
    if url.starts_with("sqlite://") {
        url.to_string()
    } else if url.starts_with("sqlite:") {
        // Convert legacy single-slash format to proper sqlx format
        let path = &url["sqlite:".len()..];
        if path.starts_with("/") || path.starts_with("./") {
            // Absolute or explicit relative path: needs triple slash
            format!("sqlite://{}", path)
        } else {
            // Plain relative path
            format!("sqlite:{}", path)
        }
    } else {
        // No prefix: treat as plain relative path
        format!("sqlite:{}", url)
    }
}

pub async fn init_db(config: &Config) -> Result<SqlitePool> {
    let database_url = normalize_sqlite_url(&config.database_url);

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

    // Fallback: Try in current working directory (ephemeral, lost on redeploy)
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
    let file_path = database_url.strip_prefix("sqlite://")
        .or_else(|| database_url.strip_prefix("sqlite:"));

    if let Some(path) = file_path {
        if path != ":memory:" && !path.is_empty() {
            let path_obj = Path::new(path);

            // Log resolved absolute path for debugging
            let abs_path = if path.starts_with("/") {
                path_obj.to_path_buf()
            } else {
                std::env::current_dir()
                    .unwrap_or_default()
                    .join(path_obj)
            };
            println!("[DB] Resolved absolute path: {}", abs_path.display());

            let parent = path_obj.parent();
            if let Some(p) = parent {
                if !p.as_os_str().is_empty() {
                    if !p.exists() {
                        println!("[DB] Creating directory: {}", p.display());
                        std::fs::create_dir_all(p)?;
                    } else {
                        println!("[DB] Directory exists: {}", p.display());
                    }

                    // Log current permissions
                    if let Ok(meta) = std::fs::metadata(p) {
                        let mode = meta.permissions().mode();
                        println!("[DB] Directory permissions: {:o} (owner={}, group={}, size={})",
                            mode & 0o777,
                            meta.uid(),
                            meta.gid(),
                            meta.len()
                        );
                    }

                    // Critical: test that the directory is actually writable
                    let test_file = p.join(".db_write_test");
                    match std::fs::File::create(&test_file) {
                        Ok(_) => {
                            let _ = std::fs::remove_file(&test_file);
                            println!("[DB] Directory is writable");
                        }
                        Err(e) => {
                            println!("[DB] WARNING: Directory is not writable: {}", e);
                        }
                    }

                    // Ensure directory is executable and writable
                    if let Err(e) = std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o777)) {
                        println!("[DB] WARNING: Could not set permissions on {}: {}", p.display(), e);
                    }
                }
            }

            if path_obj.exists() {
                println!("[DB] Database file exists, setting permissions");
                let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o666));
            } else {
                println!("[DB] Database file does not exist yet, will be created on connect");
            }
        }
    }

    println!("[DB] Opening SQLite connection...");
    let opts = SqliteConnectOptions::from_str(database_url)
        .map_err(|e| anyhow::anyhow!("Invalid SQLite connection URL: {}", e))?
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .connect_with(opts)
        .await?;
    println!("[DB] SQLite pool created successfully");

    // Enable foreign keys and WAL mode for every connection
    sqlx::query("PRAGMA foreign_keys = ON").execute(&pool).await?;
    println!("[DB] Foreign keys enabled");
    sqlx::query("PRAGMA journal_mode = WAL").execute(&pool).await?;
    println!("[DB] WAL mode enabled");

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
