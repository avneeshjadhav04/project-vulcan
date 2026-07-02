use std::sync::Arc;

use anyhow::{anyhow, bail, Context, Result};
use async_trait::async_trait;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout, Command};
use tokio::sync::{mpsc, Mutex};

/// Abstraction over any MCP transport (stdio, SSE, etc.).
#[async_trait]
pub trait McpTransport: Send + Sync {
    /// Send a single JSON-RPC message and return the raw response line/body.
    fn request(
        &mut self,
        request: Value,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Value>> + Send + '_>>;

    /// Close the transport and free resources.
    fn close(
        &mut self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + '_>>;

    /// Return a human-readable status string for diagnostics.
    fn status(&self) -> String;
}

/// Stdio transport spawns a subprocess and communicates over stdin/stdout.
pub struct StdioTransport {
    command: String,
    args: Vec<String>,
    stdin: Arc<Mutex<ChildStdin>>,
    reader: Arc<Mutex<BufReader<ChildStdout>>>,
    shutdown: mpsc::Sender<()>,
}

impl StdioTransport {
    pub async fn new(
        command: impl Into<String>,
        args: Vec<String>,
        env: Vec<(String, String)>,
    ) -> Result<Self> {
        let command = command.into();
        let mut cmd = Command::new(&command);
        cmd.args(&args)
            .envs(env.iter().cloned())
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let mut child = cmd.spawn().with_context(|| {
            format!("Failed to spawn MCP server process: {}", command)
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("Child stdin not available"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("Child stdout not available"))?;

        // Drain stderr in the background so the pipe never backs up.
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    tracing::warn!(
                        target: "mcp_server_stderr",
                        "{}",
                        line
                    );
                }
            });
        }

        // Start a task that waits for the child process to exit and reports it.
        tokio::spawn(async move {
            match child.wait().await {
                Ok(status) => {
                    if !status.success() {
                        tracing::warn!("MCP server process exited with: {:?}", status);
                    }
                }
                Err(e) => {
                    tracing::warn!("MCP server process wait failed: {}", e);
                }
            }
        });

        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);

        let transport = Self {
            command,
            args,
            stdin: Arc::new(Mutex::new(stdin)),
            reader: Arc::new(Mutex::new(BufReader::new(stdout))),
            shutdown: shutdown_tx,
        };

        // Reap-on-shutdown helper is mostly informational; the actual kill happens in close().
        let _ = shutdown_rx.recv().await;

        Ok(transport)
    }
}

#[async_trait]
impl McpTransport for StdioTransport {
    fn request(
        &mut self,
        request: Value,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Value>> + Send + '_>> {
        Box::pin(async move {
        let mut payload = serde_json::to_string(&request)?;
        payload.push('\n');

        {
            let mut stdin = self.stdin.lock().await;
            stdin.write_all(payload.as_bytes()).await?;
            stdin.flush().await?;
        }

        let mut reader = self.reader.lock().await;
        let mut line = String::new();
        let read = reader.read_line(&mut line).await?;
        if read == 0 {
            bail!("MCP server closed stdout before responding");
        }

        let line = line.trim();
        if line.is_empty() {
            bail!("MCP server returned an empty response line");
        }

        let value: Value = serde_json::from_str(line)
            .with_context(|| format!("Failed to parse MCP response: {}", line))?;
        Ok(value)
        })
    }

    fn close(
        &mut self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + '_>> {
        Box::pin(async move {
            let _ = self.shutdown.try_send(());
            let mut stdin = self.stdin.lock().await;
            let _ = stdin.shutdown().await;
            Ok(())
        })
    }

    fn status(&self) -> String {
        format!("stdio: {} {}", self.command, self.args.join(" "))
    }
}

/// SSE transport for remote MCP servers.
///
/// The official MCP SSE transport has two parts:
/// 1. An SSE stream at `url` for server-to-client messages.
/// 2. An HTTP POST endpoint (derived from the first SSE message) for client-to-server messages.
pub struct SseTransport {
    client: reqwest::Client,
    sse_url: String,
    post_url: Arc<Mutex<Option<String>>>,
    headers: Vec<(String, String)>,
    inbox: Arc<Mutex<std::collections::HashMap<u64, tokio::sync::oneshot::Sender<Result<Value>>>>>,
    next_id: Arc<Mutex<u64>>,
    _reader_handle: Option<tokio::task::JoinHandle<()>>,
}

impl SseTransport {
    pub async fn new(
        sse_url: impl Into<String>,
        headers: Vec<(String, String)>,
        client: reqwest::Client,
    ) -> Result<Self> {
        let sse_url = sse_url.into();
        let post_url: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let inbox: Arc<Mutex<std::collections::HashMap<u64, tokio::sync::oneshot::Sender<Result<Value>>>>> =
            Arc::new(Mutex::new(std::collections::HashMap::new()));
        let next_id = Arc::new(Mutex::new(1u64));

        let mut request_builder = client.get(&sse_url);
        for (k, v) in &headers {
            request_builder = request_builder.header(k, v);
        }

        let response = request_builder
            .send()
            .await
            .with_context(|| format!("Failed to connect to MCP SSE endpoint: {}", sse_url))?;

        if !response.status().is_success() {
            bail!(
                "MCP SSE endpoint returned status {} for {}",
                response.status(),
                sse_url
            );
        }

        let bytes_stream = response.bytes_stream();
        // Map the stream of bytes into chunks the StreamReader can consume.
        let byte_stream = bytes_stream.map(|result| {
            result
                .map(|bytes| bytes::Bytes::from_owner(bytes))
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
        });
        let lines = tokio_util::io::StreamReader::new(byte_stream);

        let post_url_clone = post_url.clone();
        let inbox_clone = inbox.clone();
        let sse_url_for_status = sse_url.clone();

        let reader_handle = tokio::spawn(async move {
            let mut reader = BufReader::new(lines);
            let mut line = String::new();

            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => {
                        tracing::warn!("MCP SSE stream closed for {}", sse_url_for_status);
                        break;
                    }
                    Ok(_) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        if trimmed.starts_with("data: ") {
                            let data = trimmed.trim_start_matches("data: ").trim();

                            // Some SSE implementations use a "data: endpoint ..." event to
                            // announce the POST URL. Treat any line that is a URL as that.
                            if data.starts_with("http://") || data.starts_with("https://") {
                                let mut url = post_url_clone.lock().await;
                                *url = Some(data.to_string());
                                continue;
                            }

                            if let Ok(value) = serde_json::from_str::<Value>(data) {
                                if let Some(id) = value.get("id").and_then(|v| v.as_u64()) {
                                    let tx = inbox_clone.lock().await.remove(&id);
                                    if let Some(tx) = tx {
                                        let _ = tx.send(Ok(value));
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!("MCP SSE read error for {}: {}", sse_url_for_status, e);
                        break;
                    }
                }
            }

            // Notify any pending requests that the stream died.
            let pending: Vec<_> = inbox_clone.lock().await.drain().collect();
            for (_, tx) in pending {
                let _ = tx.send(Err(anyhow!("MCP SSE stream closed")));
            }
        });

        Ok(Self {
            client,
            sse_url,
            post_url,
            headers,
            inbox,
            next_id,
            _reader_handle: Some(reader_handle),
        })
    }
}

#[async_trait]
impl McpTransport for SseTransport {
    fn request(
        &mut self,
        request: Value,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Value>> + Send + '_>> {
        Box::pin(async move {
        let id = request
            .get("id")
            .and_then(|v| v.as_u64())
            .unwrap_or_else(|| {
                let mut next = self.next_id.blocking_lock();
                let id = *next;
                *next += 1;
                id
            });

        // Wait up to 5 seconds for the POST endpoint to be announced.
        let post_url = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            async {
                loop {
                    if let Some(url) = self.post_url.lock().await.as_ref() {
                        return url.clone();
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                }
            },
        )
        .await
        .map_err(|_| anyhow!("Timed out waiting for MCP SSE POST endpoint"))?;

        let (tx, rx) = tokio::sync::oneshot::channel();
        self.inbox.lock().await.insert(id, tx);

        let mut request_builder = self.client.post(&post_url);
        for (k, v) in &self.headers {
            request_builder = request_builder.header(k, v);
        }

        let response = request_builder
            .json(&request)
            .send()
            .await
            .with_context(|| format!("Failed to POST MCP request to {}", post_url))?;

        if !response.status().is_success() {
            self.inbox.lock().await.remove(&id);
            bail!(
                "MCP POST endpoint returned status {} for {}",
                response.status(),
                post_url
            );
        }

        match tokio::time::timeout(std::time::Duration::from_secs(300), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(e)) => Err(e.into()),
            Err(_) => {
                self.inbox.lock().await.remove(&id);
                Err(anyhow!("MCP SSE request timed out"))
            }
        }
        })
    }

    fn close(
        &mut self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + '_>> {
        Box::pin(async move {
            if let Some(handle) = self._reader_handle.take() {
                handle.abort();
            }
            Ok(())
        })
    }

    fn status(&self) -> String {
        format!("sse: {}", self.sse_url)
    }
}

// Need StreamExt for the bytes_stream mapping above.
use futures::StreamExt;
