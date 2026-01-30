export interface AppMetadata {
  id: string;
  name: string;
  prompt: string;
  emoji: string;
  background_color: string;
  created_at: string;
  updated_at: string;
}

export interface GenerationComplete {
  app: AppMetadata;
}

export interface GenerationError {
  message: string;
}
