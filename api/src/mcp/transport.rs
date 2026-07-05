use std::sync::Arc;

use anyhow::{anyhow, bail, Context, Result};
use async_trait::async_trait;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

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
    /// Handle to the spawned child process, used to kill it on close.
    child: Arc<Mutex<tokio::process::Child>>,
    /// Flag set once close() has been called so we do not try to kill twice.
    closed: Arc<std::sync::atomic::AtomicBool>,
}

impl StdioTransport {
    pub async fn new(
        command: impl Into<String>,
        args: Vec<String>,
        env: Vec<(String, String)>,
    ) -> Result<Self> {
        let command = command.into();

        // Shell-split the command string so users can type a full command line
        // like `npx -y @modelcontextprotocol/server-filesystem` in the UI. We
        // treat the first token as the program and the remaining tokens as
        // leading args, then append the separately-provided `args` array.
        let tokens = shell_split(&command);
        if tokens.is_empty() {
            anyhow::bail!("MCP stdio command is empty");
        }
        let program = &tokens[0];
        let leading: Vec<String> = tokens[1..].to_vec();

        let mut cmd = Command::new(program);
        cmd.args(&leading)
            .args(&args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        // Inherit the API process environment and layer user-provided env vars
        // on top. A bare `.envs()` call would *replace* the whole environment,
        // breaking tools that rely on PATH, HOME, etc.
        for (k, v) in env {
            cmd.env(k, v);
        }

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

        let transport = Self {
            command,
            args,
            stdin: Arc::new(Mutex::new(stdin)),
            reader: Arc::new(Mutex::new(BufReader::new(stdout))),
            child: Arc::new(Mutex::new(child)),
            closed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        };

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
            if self
                .closed
                .swap(true, std::sync::atomic::Ordering::SeqCst)
            {
                return Ok(());
            }

            // Close stdin first to give the server a graceful shutdown hint.
            {
                let mut stdin = self.stdin.lock().await;
                let _ = stdin.shutdown().await;
            }

            // Ensure the child process is actually killed and reaped so it does
            // not linger as a zombie and leak memory/CPU.
            {
                let mut child = self.child.lock().await;
                if let Err(e) = child.start_kill() {
                    tracing::debug!("MCP server start_kill failed (may already be dead): {}", e);
                }
                let _ = child.wait().await;
            }

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

/// Split a command string into tokens, respecting single and double quotes.
///
/// This lets users type a full command line like
/// `npx -y @modelcontextprotocol/server-filesystem` (or with quoted args
/// `python3 -m "my server"`) into the MCP server command field, which we
/// then split into program + leading args before spawning.
fn shell_split(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut chars = input.chars().peekable();
    let mut in_quote: Option<char> = None;

    while let Some(ch) = chars.next() {
        match (in_quote, ch) {
            (Some(q), c) if c == q => in_quote = None,
            (Some(_), '\\') => {
                if let Some(next) = chars.next() {
                    current.push(next);
                }
            }
            (Some(_), c) => current.push(c),
            (None, c) if c == '"' || c == '\'' => in_quote = Some(c),
            (None, c) if c.is_whitespace() => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            (None, c) => current.push(c),
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

#[cfg(test)]
mod tests {
    use super::shell_split;

    #[test]
    fn splits_simple_command() {
        assert_eq!(
            shell_split("npx -y @modelcontextprotocol/server-filesystem"),
            vec![
                "npx".to_string(),
                "-y".to_string(),
                "@modelcontextprotocol/server-filesystem".to_string(),
            ]
        );
    }

    #[test]
    fn splits_single_program() {
        assert_eq!(shell_split("python3"), vec!["python3".to_string()]);
    }

    #[test]
    fn respects_double_quotes() {
        assert_eq!(
            shell_split(r#"python3 -m "my server""#),
            vec![
                "python3".to_string(),
                "-m".to_string(),
                "my server".to_string(),
            ]
        );
    }

    #[test]
    fn respects_single_quotes() {
        assert_eq!(
            shell_split("echo 'hello world'"),
            vec!["echo".to_string(), "hello world".to_string()]
        );
    }

    #[test]
    fn handles_empty() {
        assert!(shell_split("").is_empty());
        assert!(shell_split("   ").is_empty());
    }
}
