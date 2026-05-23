use headless_chrome::{Browser, LaunchOptions};

pub async fn browser_fetch(url: &str) -> Result<String, String> {
    let url_copy = url.to_string();
    
    // Run in a blocking task since headless_chrome is synchronous
    let res = tokio::task::spawn_blocking(move || {
        let browser = Browser::new(LaunchOptions {
            headless: true,
            sandbox: false, // Required for running in container/sandbox
            window_size: Some((1280, 800)),
            ..Default::default()
        }).map_err(|e| format!("Failed to launch browser: {}", e))?;

        let tab = browser.new_tab().map_err(|e| format!("Failed to open tab: {}", e))?;
        
        tab.navigate_to(&url_copy).map_err(|e| format!("Failed to navigate: {}", e))?;
        tab.wait_until_navigated().map_err(|e| format!("Navigation timeout: {}", e))?;

        // Wait a bit for dynamic content
        std::thread::sleep(std::time::Duration::from_secs(2));

        // Extract text from body
        let body = tab.wait_for_element("body").map_err(|e| format!("Body not found: {}", e))?;
        let text = body.get_inner_text().map_err(|e| format!("Failed to get text: {}", e))?;

        Ok::<String, String>(text)
    }).await.map_err(|e| format!("Task failed: {}", e))??;

    Ok(res)
}
