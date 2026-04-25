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

use crate::config::Config;
use crate::models::Claims;

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

pub fn create_token(user_id: &uuid::Uuid, email: &str, role: &str, config: &Config) -> Result<String> {
    let exp = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::hours(24))
        .unwrap()
        .timestamp() as usize;

    let claims = Claims {
        sub: *user_id,
        email: email.to_string(),
        role: role.to_string(),
        exp,
    };

    let private_key = std::fs::read_to_string(&config.jwt_secret_path)
        .context("Failed to read JWT private key")?;
    let encoding_key = EncodingKey::from_rsa_pem(private_key.as_bytes())?;

    let token = encode(&Header::new(Algorithm::RS256), &claims, &encoding_key)?;
    Ok(token)
}

pub fn verify_token(token: &str, config: &Config) -> Result<Claims> {
    let public_key = std::fs::read_to_string(format!("{}.pub", config.jwt_secret_path))
        .context("Failed to read JWT public key")?;
    let decoding_key = DecodingKey::from_rsa_pem(public_key.as_bytes())?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.validate_exp = true;
    validation.validate_nbf = false;

    let decoded = decode::<Claims>(token, &decoding_key, &validation)?;
    Ok(decoded.claims)
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
