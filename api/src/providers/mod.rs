use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderDefinition {
    pub id: &'static str,
    pub name: &'static str,
    pub base_url: &'static str,
    pub fallback_models: Vec<&'static str>,
}

pub fn built_in_providers() -> Vec<ProviderDefinition> {
    vec![
        ProviderDefinition {
            id: "nvidia",
            name: "NVIDIA NIM",
            base_url: "https://integrate.api.nvidia.com/v1",
            fallback_models: vec![
                "meta/llama-3.1-8b-instruct",
                "meta/llama-3.1-70b-instruct",
                "meta/llama-3.3-70b-instruct",
                "meta/llama-3.1-405b-instruct",
                "mistralai/mistral-7b-instruct-v0.3",
                "mistralai/mixtral-8x7b-instruct-v0.1",
                "mistralai/mixtral-8x22b-instruct-v0.1",
                "google/gemma-2-2b-it",
                "google/gemma-2-9b-it",
                "google/gemma-2-27b-it",
                "microsoft/phi-3-mini-128k-instruct",
                "qwen/qwen2.5-7b-instruct",
                "qwen/qwen2.5-72b-instruct",
                "deepseek-ai/deepseek-r1",
                "deepseek-ai/deepseek-r1-distill-llama-70b",
            ],
        },
        ProviderDefinition {
            id: "openai",
            name: "OpenAI",
            base_url: "https://api.openai.com/v1",
            fallback_models: vec![
                "gpt-4o",
                "gpt-4o-mini",
                "gpt-4-turbo",
                "gpt-3.5-turbo",
                "o1-preview",
                "o1-mini",
            ],
        },
        ProviderDefinition {
            id: "groq",
            name: "Groq",
            base_url: "https://api.groq.com/openai/v1",
            fallback_models: vec![
                "llama-3.1-70b-versatile",
                "llama-3.1-8b-instant",
                "mixtral-8x7b-32768",
                "gemma2-9b-it",
            ],
        },
        ProviderDefinition {
            id: "anthropic",
            name: "Anthropic (OpenAI compat)",
            base_url: "https://api.anthropic.com/v1",
            fallback_models: vec![
                "claude-3-5-sonnet-20241022",
                "claude-3-opus-20240229",
                "claude-3-sonnet-20240229",
                "claude-3-haiku-20240307",
            ],
        },
        ProviderDefinition {
            id: "ollama",
            name: "Ollama",
            base_url: "http://localhost:11434/v1",
            fallback_models: vec![
                "llama3.1",
                "mistral",
                "codellama",
                "phi3",
            ],
        },
        ProviderDefinition {
            id: "openrouter",
            name: "OpenRouter",
            base_url: "https://openrouter.ai/api/v1",
            fallback_models: vec![
                "openai/gpt-4o",
                "anthropic/claude-3.5-sonnet",
                "meta-llama/llama-3.1-70b-instruct",
                "google/gemini-pro-1.5",
            ],
        },
        ProviderDefinition {
            id: "together",
            name: "Together AI",
            base_url: "https://api.together.xyz/v1",
            fallback_models: vec![
                "meta-llama/Llama-3.1-70B-Instruct-Turbo",
                "meta-llama/Llama-3.1-8B-Instruct-Turbo",
                "mistralai/Mixtral-8x7B-Instruct-v0.1",
            ],
        },
        ProviderDefinition {
            id: "custom",
            name: "Custom Provider",
            base_url: "",
            fallback_models: vec![],
        },
    ]
}

pub fn get_provider_definition(id: &str) -> Option<ProviderDefinition> {
    built_in_providers().into_iter().find(|p| p.id == id)
}
