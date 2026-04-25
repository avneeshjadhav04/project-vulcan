use anyhow::{Context, Result};
use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret_path: Option<String>,
    pub jwt_fallback_secret: Vec<u8>,
    pub master_key: [u8; 32],
    pub nim_base_url: String,
    pub admin_default_email: String,
    pub admin_default_password: String,
    pub bind_addr: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        dotenvy::dotenv().ok();

        println!("[CONFIG] Loading environment variables...");

        let master_key_str = env::var("MASTER_KEY").context("MASTER_KEY must be set")?;
        let master_key = derive_key(&master_key_str);
        println!("[CONFIG] MASTER_KEY loaded");

        let database_url = env::var("DATABASE_URL")
            .context("DATABASE_URL must be set. If deploying on Render, ensure the PostgreSQL database is provisioned and linked to this service.")?;
        
        if database_url.trim().is_empty() {
            anyhow::bail!(
                "DATABASE_URL is set but empty. \
                This usually means the database hasn't finished provisioning yet. \
                Please wait a moment and redeploy."
            );
        }
        
        println!("[CONFIG] DATABASE_URL loaded (host masked)");

        let jwt_secret_path = env::var("JWT_SECRET_PATH").ok();
        if jwt_secret_path.is_some() {
            println!("[CONFIG] JWT_SECRET_PATH set");
        } else {
            println!("[CONFIG] JWT_SECRET_PATH not set, will use HS256 fallback");
        }
        let jwt_fallback_secret = master_key.to_vec();

        let bind_addr = env::var("PORT")
            .map(|p| {
                println!("[CONFIG] Using PORT={} from environment", p);
                format!("0.0.0.0:{}", p)
            })
            .or_else(|_| env::var("BIND_ADDR"))
            .unwrap_or_else(|_| {
                println!("[CONFIG] Using default BIND_ADDR=0.0.0.0:8080");
                "0.0.0.0:8080".to_string()
            });

        Ok(Self {
            database_url,
            jwt_secret_path,
            jwt_fallback_secret,
            master_key,
            nim_base_url: env::var("NIM_BASE_URL")
                .unwrap_or_else(|_| "https://integrate.api.nvidia.com/v1".to_string()),
            admin_default_email: env::var("ADMIN_DEFAULT_EMAIL")
                .unwrap_or_else(|_| "admin@local.local".to_string()),
            admin_default_password: env::var("ADMIN_DEFAULT_PASSWORD")
                .context("ADMIN_DEFAULT_PASSWORD must be set")?,
            bind_addr,
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
