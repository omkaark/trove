use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const APP_NAME_MAX_LENGTH: usize = 60;
pub const APP_PROMPT_MAX_LENGTH: usize = 2000;

pub fn validate_name_prompt(name: &str, prompt: &str) -> Result<(), String> {
    let trimmed_name = name.trim();
    let trimmed_prompt = prompt.trim();

    if trimmed_name.is_empty() {
        return Err("App name is required".to_string());
    }
    if trimmed_prompt.is_empty() {
        return Err("Prompt is required".to_string());
    }
    if trimmed_name.len() > APP_NAME_MAX_LENGTH {
        return Err(format!(
            "App name must be at most {} characters",
            APP_NAME_MAX_LENGTH
        ));
    }
    if trimmed_prompt.len() > APP_PROMPT_MAX_LENGTH {
        return Err(format!(
            "Prompt must be at most {} characters",
            APP_PROMPT_MAX_LENGTH
        ));
    }
    if trimmed_name.chars().any(|ch| ch.is_control()) {
        return Err("App name contains invalid characters".to_string());
    }
    if trimmed_prompt.chars().any(|ch| {
        ch == '\0' || (ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))
    }) {
        return Err("Prompt contains invalid characters".to_string());
    }

    Ok(())
}

fn default_emoji() -> String {
    "✨".to_string()
}

fn default_background_color() -> String {
    "#6366F1".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppMetadata {
    pub id: Uuid,
    pub name: String,
    pub prompt: String,
    #[serde(default = "default_emoji")]
    pub emoji: String,
    #[serde(default = "default_background_color")]
    pub background_color: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl AppMetadata {
    pub fn new(name: String, prompt: String, emoji: String, background_color: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            name,
            prompt,
            emoji,
            background_color,
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AppsIndex {
    pub apps: Vec<AppMetadata>,
}

impl AppsIndex {
    pub fn add(&mut self, app: AppMetadata) {
        self.apps.push(app);
    }

    pub fn remove(&mut self, id: Uuid) -> Option<AppMetadata> {
        if let Some(pos) = self.apps.iter().position(|a| a.id == id) {
            Some(self.apps.remove(pos))
        } else {
            None
        }
    }

    pub fn get(&self, id: Uuid) -> Option<&AppMetadata> {
        self.apps.iter().find(|a| a.id == id)
    }

    pub fn get_mut(&mut self, id: Uuid) -> Option<&mut AppMetadata> {
        self.apps.iter_mut().find(|a| a.id == id)
    }
}
