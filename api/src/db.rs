use anyhow::Result;
use sqlx::SqlitePool;

use crate::config::Config;
use crate::models::User;

pub async fn init_db(config: &Config) -> Result<SqlitePool> {
    let database_url = if config.database_url.starts_with("sqlite:") {
        config.database_url.clone()
    } else {
        format!("sqlite:{}", config.database_url)
    };

    println!("[DB] Connecting to SQLite database at: {}", database_url);
    
    let pool = SqlitePool::connect(&database_url).await?;
    println!("[DB] Connected successfully");

    println!("[DB] Running migrations...");
    sqlx::migrate!("../db/migrations").run(&pool).await?;
    println!("[DB] Migrations complete");

    seed_admin(&pool, config).await?;

    Ok(pool)
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
