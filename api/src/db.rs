use anyhow::Result;
use sqlx::PgPool;
use std::time::Duration;

use crate::config::Config;
use crate::models::User;

pub async fn init_db(config: &Config) -> Result<PgPool> {
    let database_url = if config.database_url.contains("sslmode=") {
        config.database_url.clone()
    } else {
        format!("{}?sslmode=require", config.database_url)
    };

    let pool = retry_connect(&database_url, 10).await?;

    tracing::info!("Running database migrations...");
    sqlx::migrate!("../db/migrations").run(&pool).await?;
    tracing::info!("Migrations complete");

    seed_admin(&pool, config).await?;

    Ok(pool)
}

async fn retry_connect(database_url: &str, max_retries: u32) -> Result<PgPool> {
    let mut last_err = None;
    for i in 0..max_retries {
        match PgPool::connect(database_url).await {
            Ok(pool) => {
                tracing::info!("Connected to database after {} attempt(s)", i + 1);
                return Ok(pool);
            }
            Err(e) => {
                tracing::warn!("Database connection attempt {} failed: {}", i + 1, e);
                last_err = Some(e);
                if i < max_retries - 1 {
                    tokio::time::sleep(Duration::from_secs(2u64.pow(i.min(4)))).await;
                }
            }
        }
    }
    anyhow::bail!(
        "Failed to connect to database after {} attempts: {:?}",
        max_retries,
        last_err
    )
}

async fn seed_admin(pool: &PgPool, config: &Config) -> Result<()> {
    let existing = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1")
        .bind(&config.admin_default_email)
        .fetch_optional(pool)
        .await?;

    if existing.is_none() {
        let hash = crate::auth::hash_password(&config.admin_default_password)?;
        sqlx::query(
            "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin')",
        )
        .bind(&config.admin_default_email)
        .bind(&hash)
        .execute(pool)
        .await?;
        tracing::info!("Created default admin user");
    }

    Ok(())
}
