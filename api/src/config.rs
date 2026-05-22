use anyhow::{Context, Result};
use std::env;
use std::path::Path;

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret_path: Option<String>,
    pub jwt_fallback_secret: Vec<u8>,
    pub master_key: [u8; 32],
    pub nim_base_url: String,
    pub bind_addr: String,
    pub cookie_secure: bool,
    pub cors_origin: Option<String>,
    pub app_base_url: String,
    pub google_client_id: Option<String>,
    pub google_client_secret: Option<String>,
    pub todoist_client_id: Option<String>,
    pub todoist_client_secret: Option<String>,
}

fn load_or_generate_master_key() -> Result<[u8; 32]> {
    use rand::Rng;

    // Prefer explicit env var
    if let Ok(key_str) = env::var("MASTER_KEY") {
        if !key_str.trim().is_empty() {
            println!("[CONFIG] MASTER_KEY loaded from environment");
            return Ok(derive_key(&key_str));
        }
    }

    // Derive key file path from DATABASE_URL directory, fallback to current dir
    let key_path = env::var("DATABASE_URL")
        .ok()
        .and_then(|url| {
            let path = url
                .strip_prefix("sqlite:///")
                .or_else(|| url.strip_prefix("sqlite:"))?;
            Path::new(path).parent().map(|p| p.join(".master_key"))
        })
        .unwrap_or_else(|| Path::new(".master_key").to_path_buf());

    if key_path.exists() {
        let contents = std::fs::read_to_string(&key_path)
            .with_context(|| format!("Failed to read master key from {}", key_path.display()))?;
        let key_str = contents.trim();
        if !key_str.is_empty() {
            println!("[CONFIG] MASTER_KEY loaded from {}", key_path.display());
            return Ok(derive_key(key_str));
        }
    }

    // Generate a new cryptographically secure random key
    let new_key: String = rand::thread_rng()
        .sample_iter(rand::distributions::Alphanumeric)
        .take(64)
        .map(char::from)
        .collect();

    if let Some(parent) = key_path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            let _ = std::fs::create_dir_all(parent);
        }
    }

    std::fs::write(&key_path, &new_key)
        .with_context(|| format!("Failed to write master key to {}", key_path.display()))?;

    // Restrict permissions
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600));
    }

    println!(
        "[CONFIG] MASTER_KEY auto-generated and saved to {}",
        key_path.display()
    );
    Ok(derive_key(&new_key))
}

impl Config {
    pub fn from_env() -> Result<Self> {
        dotenvy::dotenv().ok();

        println!("[CONFIG] Loading environment variables...");

        let master_key = load_or_generate_master_key()?;
        println!("[CONFIG] MASTER_KEY ready");

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
            println!("[CONFIG] CORS restricted to predefined development origins");
        }

        Ok(Self {
            database_url,
            jwt_secret_path,
            jwt_fallback_secret,
            master_key,
            nim_base_url: env::var("NIM_BASE_URL")
                .unwrap_or_else(|_| "https://integrate.api.nvidia.com/v1".to_string()),
            bind_addr,
            cookie_secure,
            cors_origin,
            app_base_url: env::var("APP_BASE_URL")
                .unwrap_or_else(|_| "http://localhost:8080".to_string()),
            google_client_id: env::var("GOOGLE_CLIENT_ID").ok(),
            google_client_secret: env::var("GOOGLE_CLIENT_SECRET").ok(),
            todoist_client_id: env::var("TODOIST_CLIENT_ID").ok(),
            todoist_client_secret: env::var("TODOIST_CLIENT_SECRET").ok(),
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
