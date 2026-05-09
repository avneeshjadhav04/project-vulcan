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
    pub cookie_secure: bool,
    pub cors_origin: Option<String>,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        dotenvy::dotenv().ok();

        println!("[CONFIG] Loading environment variables...");

        let master_key_str = env::var("MASTER_KEY").context("MASTER_KEY must be set")?;
        let master_key = derive_key(&master_key_str);
        println!("[CONFIG] MASTER_KEY loaded");

        let database_url = match env::var("DATABASE_URL") {
            Ok(url) if !url.trim().is_empty() => {
                println!("[CONFIG] DATABASE_URL loaded from environment");
                url
            }
            _ => {
                println!("[CONFIG] DATABASE_URL not set, using default: sqlite:///data/vulcan.db");
                "sqlite:///data/vulcan.db".to_string()
            }
        };

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

        let cookie_secure = env::var("COOKIE_SECURE")
            .map(|v| v == "true" || v == "1")
            .unwrap_or_else(|_| {
                // Default to false for local dev, true for production if HTTPS is expected
                bind_addr.contains(":443") || env::var("RENDER").is_ok()
            });
        println!("[CONFIG] Cookie Secure={}", cookie_secure);

        let cors_origin = env::var("CORS_ORIGIN").ok();
        if let Some(ref origin) = cors_origin {
            println!("[CONFIG] CORS restricted to: {}", origin);
        } else {
            println!("[CONFIG] CORS using mirror_request (dev mode)");
        }

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
            cookie_secure,
            cors_origin,
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
