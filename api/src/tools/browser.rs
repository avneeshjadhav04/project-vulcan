use headless_chrome::{Browser, LaunchOptions};

pub async fn browser_fetch(url: &str) -> Result<String, String> {
    // Validate URL to prevent navigation to internal resources
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("Invalid URL: {}", e))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!("Unsupported URL scheme: {}. Only http and https are allowed.", scheme));
    }
    
    let url_copy = url.to_string();
    
    // Run in a blocking task since headless_chrome is synchronous
    let res = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        tokio::task::spawn_blocking(move || {
            let browser = Browser::new(LaunchOptions {
                headless: true,
                sandbox: false, // Required for running in container/sandbox
                window_size: Some((1280, 800)),
                ..Default::default()
            }).map_err(|e| format!("Failed to launch browser: {}", e))?;

            let tab = browser.new_tab().map_err(|e| format!("Failed to open tab: {}", e))?;
            
            tab.navigate_to(&url_copy).map_err(|e| format!("Failed to navigate: {}", e))?;
            tab.wait_until_navigated().map_err(|e| format!("Navigation timeout: {}", e))?;
            
            // Check HTTP status via JavaScript
            let _status_code: Result<String, _> = tab.evaluate(
                "document.readyState === 'complete' ? 'ok' : 'pending'",
                false,
            ).map(|v| v.value.map(|v| v.to_string()).unwrap_or_default());
            
            // Wait a bit for dynamic content
            std::thread::sleep(std::time::Duration::from_secs(2));

            // Extract text from body
            let body = tab.wait_for_element("body").map_err(|e| format!("Body not found: {}", e))?;
            let text = body.get_inner_text().map_err(|e| format!("Failed to get text: {}", e))?;
            
            // Basic content filtering: remove script/style content
            let filtered = text
                .lines()
                .filter(|line| !line.trim().starts_with("function ") && !line.trim().starts_with("var "))
                .collect::<Vec<_>>()
                .join("\n");

            Ok::<String, String>(filtered)
        })
    )
    .await
    .map_err(|_| "Browser fetch timed out after 30 seconds".to_string())?
    .map_err(|e| format!("Task failed: {}", e))??;

    Ok(res)
}
