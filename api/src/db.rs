use anyhow::Result;
use sqlx::PgPool;

use crate::config::Config;
use crate::models::User;

pub async fn init_db(config: &Config) -> Result<PgPool> {
    let pool = PgPool::connect(&config.database_url).await?;

    sqlx::migrate!("../db/migrations").run(&pool).await?;

    seed_admin(&pool, config).await?;

    Ok(pool)
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
