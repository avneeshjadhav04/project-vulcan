use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use anyhow::{Context, Result};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use base64::Engine;
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};

use crate::middleware::AppState;
use crate::models::Claims;

pub const MAX_PASSWORD_LENGTH: usize = 256;
pub const MAX_EMAIL_LENGTH: usize = 254;
pub const JWT_ISSUER: &str = "vulcan";
pub const JWT_AUDIENCE: &str = "vulcan";

pub fn hash_password(password: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!(e))?;
    Ok(hash.to_string())
}

pub fn verify_password(password: &str, hash: &str) -> Result<bool> {
    let parsed_hash = PasswordHash::new(hash).map_err(|e| anyhow::anyhow!(e))?;
    let argon2 = Argon2::default();
    Ok(argon2
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

pub fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

pub fn validate_email(email: &str) -> Result<()> {
    if email.is_empty() {
        anyhow::bail!("Email is required");
    }
    if email.len() > MAX_EMAIL_LENGTH {
        anyhow::bail!("Email must be at most {} characters", MAX_EMAIL_LENGTH);
    }
    // Basic RFC 5322-ish validation
    let re = regex::Regex::new(r"^[^@\s]+@[^@\s]+\.[^@\s]+$").unwrap();
    if !re.is_match(email) {
        anyhow::bail!("Invalid email format");
    }
    Ok(())
}

pub fn validate_password(password: &str) -> Result<()> {
    if password.len() < 6 {
        anyhow::bail!("Password must be at least 6 characters");
    }
    if password.len() > MAX_PASSWORD_LENGTH {
        anyhow::bail!("Password must be at most {} characters", MAX_PASSWORD_LENGTH);
    }
    Ok(())
}

pub fn create_token(user_id: &str, email: &str, role: &str, state: &AppState) -> Result<String> {
    let exp = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::hours(24))
        .ok_or_else(|| anyhow::anyhow!("Timestamp overflow"))?
        .timestamp() as usize;

    let claims = Claims {
        sub: user_id.to_string(),
        email: email.to_string(),
        role: role.to_string(),
        exp,
        iss: JWT_ISSUER.to_string(),
        aud: JWT_AUDIENCE.to_string(),
    };

    // Try RSA first, fallback to HS256
    if let Some(ref path) = state.config.jwt_secret_path {
        if std::path::Path::new(path).exists() {
            let private_key = std::fs::read_to_string(path)
                .context("Failed to read JWT private key")?;
            let encoding_key = EncodingKey::from_rsa_pem(private_key.as_bytes())?;
            let token = encode(&Header::new(Algorithm::RS256), &claims, &encoding_key)?;
            return Ok(token);
        }
    }

    // HS256 fallback for environments without RSA keys (e.g., Render)
    let encoding_key = EncodingKey::from_secret(&state.config.jwt_fallback_secret);
    let token = encode(&Header::new(Algorithm::HS256), &claims, &encoding_key)?;
    Ok(token)
}

pub fn verify_token(token: &str, state: &AppState) -> Result<Claims> {
    // Try RSA first, fallback to HS256
    if let Some(ref pub_key) = state.jwt_public_key {
        let decoding_key = DecodingKey::from_rsa_pem(pub_key)?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.validate_exp = true;
        validation.validate_nbf = false;
        validation.set_issuer(&[JWT_ISSUER]);
        validation.set_audience(&[JWT_AUDIENCE]);
        let decoded = decode::<Claims>(token, &decoding_key, &validation)?;
        return Ok(decoded.claims);
    }

    // HS256 fallback
    let decoding_key = DecodingKey::from_secret(&state.config.jwt_fallback_secret);
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    validation.validate_nbf = false;
    validation.set_issuer(&[JWT_ISSUER]);
    validation.set_audience(&[JWT_AUDIENCE]);
    let decoded = decode::<Claims>(token, &decoding_key, &validation)?;
    Ok(decoded.claims)
}

pub fn generate_csrf_token() -> String {
    let bytes: [u8; 32] = rand::random();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&bytes)
}

pub fn encrypt_key(plaintext: &str, master_key: &[u8; 32]) -> Result<String> {
    let cipher = Aes256Gcm::new_from_slice(master_key)?;
    let nonce_bytes = rand::random::<[u8; 12]>();
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| anyhow::anyhow!(e))?;
    let mut result = Vec::new();
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);
    Ok(base64::engine::general_purpose::STANDARD.encode(&result))
}

pub fn decrypt_key(ciphertext_b64: &str, master_key: &[u8; 32]) -> Result<String> {
    let decoded = base64::engine::general_purpose::STANDARD.decode(ciphertext_b64)?;
    if decoded.len() < 12 {
        anyhow::bail!("Invalid ciphertext");
    }
    let (nonce_bytes, ciphertext) = decoded.split_at(12);
    let cipher = Aes256Gcm::new_from_slice(master_key)?;
    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| anyhow::anyhow!(e))?;
    Ok(String::from_utf8(plaintext)?)
}
