use anyhow::{Context, Result};
use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret_path: String,
    pub master_key: [u8; 32],
    pub nim_base_url: String,
    pub admin_default_email: String,
    pub admin_default_password: String,
    pub bind_addr: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        dotenvy::dotenv().ok();

        let master_key_str = env::var("MASTER_KEY").context("MASTER_KEY must be set")?;
        let master_key = derive_key(&master_key_str);

        Ok(Self {
            database_url: env::var("DATABASE_URL").context("DATABASE_URL must be set")?,
            jwt_secret_path: env::var("JWT_SECRET_PATH")
                .unwrap_or_else(|_| "./secrets/jwt_private.pem".to_string()),
            master_key,
            nim_base_url: env::var("NIM_BASE_URL")
                .unwrap_or_else(|_| "https://integrate.api.nvidia.com/v1".to_string()),
            admin_default_email: env::var("ADMIN_DEFAULT_EMAIL")
                .unwrap_or_else(|_| "admin@local.local".to_string()),
            admin_default_password: env::var("ADMIN_DEFAULT_PASSWORD")
                .context("ADMIN_DEFAULT_PASSWORD must be set")?,
            bind_addr: env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".to_string()),
        })
    }
}

fn derive_key(input: &str) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(input.as_bytes());
    let mut key = [0u8; 32];
    key.copy_from_slice(&hash);
    key
}
