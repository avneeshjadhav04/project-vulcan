use std::sync::Arc;
use tokio::sync::Mutex;
use fastembed::TextEmbedding;

#[derive(Clone)]
pub struct MemoryStore {
    embedder: Arc<Mutex<Option<TextEmbedding>>>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self {
            embedder: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn embed(&self, text: &str) -> Result<Vec<f32>, String> {
        let mut guard = self.embedder.lock().await;
        if guard.is_none() {
            let model = TextEmbedding::try_new(Default::default())
                .map_err(|e| format!("Failed to load embedding model: {}", e))?;
            *guard = Some(model);
        }
        let model = guard.as_mut().unwrap();
        let embeddings = model.embed(vec![text], None).map_err(|e| e.to_string())?;

        if let Some(first) = embeddings.into_iter().next() {
            Ok(first)
        } else {
            Err("No embedding generated".to_string())
        }
    }
}

// Basic cosine similarity
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot_product: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot_product / (norm_a * norm_b)
}

/// Serialize a Vec<f32> to bytes for SQLite storage
pub fn serialize_embedding(embedding: &[f32]) -> Vec<u8> {
    embedding.iter()
        .flat_map(|f| f.to_le_bytes())
        .collect()
}

/// Deserialize bytes back to Vec<f32>
pub fn deserialize_embedding(bytes: &[u8]) -> Vec<f32> {
    bytes.chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}
