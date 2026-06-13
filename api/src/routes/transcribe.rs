use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    extract::{Extension, Multipart, State},
    http::StatusCode,
    response::{Json, Response},
    routing::{get, post},
    Router,
};
use serde::Serialize;

use crate::middleware::AppState;
use crate::models::Claims;

#[derive(Serialize)]
struct TranscriptionResponse {
    text: String,
    confidence: f32,
}

enum StreamResult {
    Partial(String),
    Final { text: String, confidence: f32 },
    Error(String),
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/transcribe", post(transcribe_audio))
        .route("/transcribe/stream", get(transcribe_stream))
}

async fn transcribe_stream(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Extension(_claims): Extension<Claims>,
) -> Response {
    ws.on_upgrade(move |socket| handle_stream(socket, state))
}

async fn handle_stream(mut socket: WebSocket, state: AppState) {
    let model = match state.vosk_model {
        Some(m) => m,
        None => {
            let msg = serde_json::json!({"type": "error", "error": "Vosk model not loaded" }).to_string();
            let _ = socket.send(Message::Text(msg)).await;
            let _ = socket.close().await;
            return;
        }
    };

    // Audio channel: async task -> blocking Vosk thread
    let (audio_tx, mut audio_rx) = tokio::sync::mpsc::channel::<Vec<i16>>(128);
    // Result channel: blocking Vosk thread -> async task
    let (result_tx, mut result_rx) = tokio::sync::mpsc::channel::<StreamResult>(128);

    // Spawn Vosk recognizer on a dedicated blocking thread
    let vosk_handle = tokio::task::spawn_blocking(move || {
        let model = match model.lock() {
            Ok(m) => m,
            Err(e) => {
                let _ = result_tx.blocking_send(StreamResult::Error(format!("Model lock failed: {:?}", e)));
                return;
            }
        };

        let mut recognizer = match vosk::Recognizer::new(&*model, 16000.0) {
            Some(r) => r,
            None => {
                let _ = result_tx.blocking_send(StreamResult::Error("Failed to create recognizer".to_string()));
                return;
            }
        };

        // Enable partial results
        recognizer.set_partial_words(true);

        let mut last_partial = String::new();

        while let Some(chunk) = audio_rx.blocking_recv() {
            recognizer.accept_waveform(&chunk);

            let partial = recognizer.partial_result();
            let text = partial.partial.to_string();
            if !text.is_empty() && text != last_partial {
                last_partial = text.clone();
                if result_tx.blocking_send(StreamResult::Partial(text)).is_err() {
                    break;
                }
            }
        }

        // Final result
        let result = recognizer.final_result();
        if let Some(single) = result.single() {
            let text = single.text.to_string();
            let confidence = if single.result.is_empty() {
                0.0
            } else {
                single.result.iter().map(|r| r.conf as f32).sum::<f32>() / single.result.len() as f32
            };
            let _ = result_tx.blocking_send(StreamResult::Final { text, confidence });
        }
    });

    // Main async loop: read from WebSocket and send audio, or read results and send back
    let mut audio_tx = Some(audio_tx);
    let mut running = true;

    while running {
        tokio::select! {
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Binary(data))) => {
                        // Convert little-endian bytes to i16 PCM
                        if data.len() % 2 != 0 {
                            continue;
                        }
                        let i16_data: Vec<i16> = data.chunks_exact(2)
                            .map(|b| i16::from_le_bytes([b[0], b[1]]))
                            .collect();
                        if let Some(ref tx) = audio_tx {
                            if tx.send(i16_data).await.is_err() {
                                // Vosk thread died
                                audio_tx = None;
                            }
                        }
                    }
                    Some(Ok(Message::Text(text))) => {
                        if text == "stop" {
                            // Client wants to stop - drop audio channel to signal EOS
                            audio_tx = None;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        // Client disconnected
                        audio_tx = None;
                        running = false;
                    }
                    _ => {}
                }
            }
            result = result_rx.recv() => {
                match result {
                    Some(StreamResult::Partial(text)) => {
                        let msg = serde_json::json!({"type": "partial", "text": text}).to_string();
                        if socket.send(Message::Text(msg)).await.is_err() {
                            running = false;
                        }
                    }
                    Some(StreamResult::Final { text, confidence }) => {
                        let msg = serde_json::json!({
                            "type": "final",
                            "text": text,
                            "confidence": confidence
                        }).to_string();
                        let _ = socket.send(Message::Text(msg)).await;
                        running = false;
                    }
                    Some(StreamResult::Error(error)) => {
                        let msg = serde_json::json!({"type": "error", "error": error}).to_string();
                        let _ = socket.send(Message::Text(msg)).await;
                        running = false;
                    }
                    None => {
                        // Vosk thread closed channel
                        running = false;
                    }
                }
            }
        }
    }

    // Make sure audio channel is dropped so Vosk thread exits
    drop(audio_tx);
    let _ = vosk_handle.await;
    let _ = socket.close().await;
}

async fn transcribe_audio(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<TranscriptionResponse>, StatusCode> {
    // Extract audio blob from multipart
    let mut audio_blob: Option<Vec<u8>> = None;
    
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)?
    {
        let name = field.name().unwrap_or("unknown").to_string();
        if name == "audio" {
            let data = field.bytes().await.map_err(|_| StatusCode::BAD_REQUEST)?;
            // Limit to ~10MB (60 seconds of WebM/Opus at reasonable quality)
            if data.len() > 10 * 1024 * 1024 {
                return Err(StatusCode::PAYLOAD_TOO_LARGE);
            }
            audio_blob = Some(data.to_vec());
            break;
        }
    }
    
    let audio_blob = audio_blob.ok_or(StatusCode::BAD_REQUEST)?;
    
    // Check if Vosk model is available
    let model = match &state.vosk_model {
        Some(m) => m,
        None => {
            tracing::error!("Vosk model not loaded");
            return Err(StatusCode::SERVICE_UNAVAILABLE);
        }
    };
    
    // Decode audio blob to f32 PCM (16kHz, mono)
    let samples = match decode_audio(&audio_blob) {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("Audio decoding failed: {}", e);
            return Err(StatusCode::BAD_REQUEST);
        }
    };
    
    // Transcribe with Vosk
    let (text, confidence) = match transcribe_with_vosk(model, &samples) {
        Ok(result) => result,
        Err(e) => {
            tracing::error!("Transcription failed: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };
    
    Ok(Json(TranscriptionResponse {
        text,
        confidence,
    }))
}

fn decode_audio(data: &[u8]) -> anyhow::Result<Vec<f32>> {
    // Try to decode using symphonia
    use symphonia::core::audio::{AudioBufferRef, SampleBuffer, Signal};
    use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
    use symphonia::core::formats::{FormatOptions};
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::probe::Hint;
    
    let mss = MediaSourceStream::new(Box::new(std::io::Cursor::new(data.to_vec())), Default::default());
    let hint = Hint::new();
    
    // Probe the format
    let format_opts = FormatOptions::default();
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &format_opts, &Default::default())
        .map_err(|e| anyhow::anyhow!("Failed to probe audio format: {:?}", e))?;
    
    let mut format = probed.format;
    let track = format.tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| anyhow::anyhow!("No audio track found"))?;
    
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| anyhow::anyhow!("Failed to create decoder: {:?}", e))?;
    
    // Get sample rate from track
    let sample_rate = track.codec_params.sample_rate.unwrap_or(48000);
    let channels = track.codec_params.channels.as_ref().map(|c| c.count()).unwrap_or(1);
    
    // Collect all samples
    let mut all_samples: Vec<f32> = Vec::new();
    
    loop {
        match format.next_packet() {
            Ok(packet) => {
                if packet.track_id() != track_id {
                    continue;
                }
                
                match decoder.decode(&packet) {
                    Ok(decoded) => {
                        match decoded {
                            AudioBufferRef::F32(buf) => {
                                // Convert to mono
                                let num_frames = buf.frames();
                                for frame in 0..num_frames {
                                    let mut sum = 0.0;
                                    for ch in 0..channels {
                                        sum += buf.chan(ch)[frame];
                                    }
                                    all_samples.push(sum / channels as f32);
                                }
                            }
                            AudioBufferRef::S16(buf) => {
                                let num_frames = buf.frames();
                                for frame in 0..num_frames {
                                    let mut sum = 0.0;
                                    for ch in 0..channels {
                                        sum += (buf.chan(ch)[frame] as f32) / 32768.0;
                                    }
                                    all_samples.push(sum / channels as f32);
                                }
                            }
                            _ => {
                                // Handle other sample formats
                                let num_frames = decoded.frames();
                                let num_channels = decoded.spec().channels.count();
                                let mut sample_buf = SampleBuffer::<f32>::new(
                                    num_frames as u64,
                                    *decoded.spec(),
                                );
                                sample_buf.copy_interleaved_ref(decoded);
                                
                                let interleaved = sample_buf.samples();
                                for frame in 0..num_frames {
                                    let mut sum = 0.0;
                                    for ch in 0..num_channels {
                                        sum += interleaved[frame * num_channels + ch];
                                    }
                                    all_samples.push(sum / num_channels as f32);
                                }
                            }
                        }
                    }
                    Err(_) => continue,
                }
            }
            Err(_) => break,
        }
    }
    
    // Resample to 16kHz if needed
    let target_rate = 16000;
    if sample_rate != target_rate {
        use rubato::Resampler;
        use rubato::SincInterpolationParameters;
        
        let params = SincInterpolationParameters {
            sinc_len: 256,
            f_cutoff: 0.95,
            interpolation: rubato::SincInterpolationType::Linear,
            oversampling_factor: 128,
            window: rubato::WindowFunction::BlackmanHarris2,
        };
        
        let mut resampler = rubato::SincFixedIn::<f32>::new(
            target_rate as f64 / sample_rate as f64,
            2.0,
            params,
            all_samples.len(),
            1,
        ).map_err(|e| anyhow::anyhow!("Resampler creation failed: {:?}", e))?;
        
        let input = vec![all_samples];
        let output = resampler.process(&input, None)
            .map_err(|e| anyhow::anyhow!("Resampling failed: {:?}", e))?;
        
        all_samples = output[0].clone();
    }
    
    Ok(all_samples)
}

fn transcribe_with_vosk(
    model: &std::sync::Mutex<vosk::Model>,
    samples: &[f32],
) -> anyhow::Result<(String, f32)> {
    let model = model.lock().map_err(|e| anyhow::anyhow!("Model lock failed: {:?}", e))?;
    
    let mut recognizer = vosk::Recognizer::new(&*model, 16000.0)
        .ok_or_else(|| anyhow::anyhow!("Failed to create recognizer"))?;
    
    // Convert f32 to i16 for Vosk
    let i16_samples: Vec<i16> = samples.iter()
        .map(|&s| (s * 32768.0).clamp(-32768.0, 32767.0) as i16)
        .collect();
    
    // Process in chunks
    const CHUNK_SIZE: usize = 4096;
    for chunk in i16_samples.chunks(CHUNK_SIZE) {
        recognizer.accept_waveform(chunk);
    }
    
    let result = recognizer.final_result();
    let single = result.single()
        .ok_or_else(|| anyhow::anyhow!("No transcription result"))?;
    
    let text = single.text.to_string();
    // Calculate average confidence from word results
    let confidence = if single.result.is_empty() {
        0.0
    } else {
        let total_conf: f32 = single.result.iter().map(|r| r.conf as f32).sum();
        total_conf / single.result.len() as f32
    };
    
    Ok((text, confidence))
}
