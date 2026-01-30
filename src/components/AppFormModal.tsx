import { useEffect, useRef, useState } from "react";
import type { AppMetadata } from "../types";
import { APP_NAME_MAX_LENGTH, APP_PROMPT_MAX_LENGTH } from "../constants";
import { Modal } from "./Modal";

type AppFormMode = "new" | "edit";

const PRESET_EMOJIS = [
  "✨", "💰", "📝", "📊", "🎯", "🔥", "💡", "🚀",
  "📅", "🎨", "🛒", "💬", "🎵", "📸", "🏠", "⚡",
];

const PRESET_COLORS = [
  "#6366F1", "#8B5CF6", "#EC4899", "#EF4444",
  "#F97316", "#F59E0B", "#84CC16", "#22C55E",
  "#14B8A6", "#06B6D4", "#0EA5E9", "#3B82F6",
  "#6B7280", "#78716C", "#92400E", "#065F46",
];

const DEFAULT_EMOJI = "✨";
const DEFAULT_COLOR = "#6366F1";

interface AppFormModalProps {
  isOpen: boolean;
  mode: AppFormMode;
  app?: AppMetadata | null;
  isSubmitting?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (name: string, prompt: string, emoji: string, backgroundColor: string) => Promise<void> | void;
}

export function AppFormModal({
  isOpen,
  mode,
  app = null,
  isSubmitting,
  error,
  onClose,
  onSubmit,
}: AppFormModalProps) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [emoji, setEmoji] = useState(DEFAULT_EMOJI);
  const [backgroundColor, setBackgroundColor] = useState(DEFAULT_COLOR);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [internalSubmitting, setInternalSubmitting] = useState(false);
  const internalSubmittingRef = useRef(false);

  const isEditMode = mode === "edit";
  const isControlledSubmitting = typeof isSubmitting === "boolean";
  const submitting = isControlledSubmitting ? isSubmitting : internalSubmitting;

  useEffect(() => {
    if (!isOpen) return;
    setHasSubmitted(false);
    if (isEditMode && app) {
      setName(app.name);
      setPrompt(app.prompt);
      setEmoji(app.emoji || DEFAULT_EMOJI);
      setBackgroundColor(app.background_color || DEFAULT_COLOR);
    } else if (!isEditMode) {
      setName("");
      setPrompt("");
      setEmoji(DEFAULT_EMOJI);
      setBackgroundColor(DEFAULT_COLOR);
    }
    if (!isControlledSubmitting) {
      setInternalSubmitting(false);
      internalSubmittingRef.current = false;
    }
  }, [isOpen, isEditMode, app, isControlledSubmitting]);

  if (!isOpen || (isEditMode && !app)) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting || internalSubmittingRef.current) return;
    setHasSubmitted(true);
    const trimmedName = name.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedName || !trimmedPrompt) return;

    if (!isControlledSubmitting) {
      internalSubmittingRef.current = true;
      setInternalSubmitting(true);
    }

    let success = false;
    try {
      await onSubmit(trimmedName, trimmedPrompt, emoji, backgroundColor);
      success = true;
    } finally {
      if (!isControlledSubmitting) {
        internalSubmittingRef.current = false;
        setInternalSubmitting(false);
      }
    }

    if (success && !isEditMode) {
      setName("");
      setPrompt("");
      setEmoji(DEFAULT_EMOJI);
      setBackgroundColor(DEFAULT_COLOR);
      setHasSubmitted(false);
      onClose();
    }
  };

  const title = isEditMode ? "Edit App" : "New App";
  const submitLabel = isEditMode ? "Update" : "Generate";
  const submittingLabel = isEditMode ? "Updating..." : "Generating...";
  const nameId = isEditMode ? "edit-app-name" : "app-name";
  const promptId = isEditMode ? "edit-app-prompt" : "app-prompt";
  const promptPlaceholder = isEditMode
    ? "Describe the app in detail."
    : "A todo list app with the ability to add, complete, and delete tasks. Include a dark mode toggle.";

  return (
    <Modal isOpen={isOpen} onClose={onClose} disableClose={Boolean(submitting)}>
      <div className="modal-header">
        <h2>{title}</h2>
        <button className="modal-close" onClick={onClose} disabled={submitting}>
          &times;
        </button>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <div className="form-label-row">
            <label htmlFor={nameId}>Name</label>
            <span className="form-char-count">
              {name.length}/{APP_NAME_MAX_LENGTH}
            </span>
          </div>
          <input
            id={nameId}
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="My Cool App"
            autoFocus
            maxLength={APP_NAME_MAX_LENGTH}
          />
          {hasSubmitted && !name.trim() && (
            <div className="form-error">Name is required.</div>
          )}
        </div>

        <div className="form-group">
          <label>Icon</label>
          <div className="icon-picker-section">
            <div
              className="icon-preview"
              style={{ backgroundColor }}
            >
              <span className="icon-preview-emoji">{emoji}</span>
            </div>
            <div className="picker-grids">
              <div className="emoji-grid">
                {PRESET_EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className={`emoji-option ${emoji === e ? "selected" : ""}`}
                    onClick={() => setEmoji(e)}
                  >
                    {e}
                  </button>
                ))}
              </div>
              <div className="color-grid">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`color-option ${backgroundColor === c ? "selected" : ""}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setBackgroundColor(c)}
                    aria-label={`Select color ${c}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="form-group">
          <div className="form-label-row">
            <label htmlFor={promptId}>Detailed Description</label>
            <span className="form-char-count">
              {prompt.length}/{APP_PROMPT_MAX_LENGTH}
            </span>
          </div>
          <textarea
            id={promptId}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={promptPlaceholder}
            rows={5}
            maxLength={APP_PROMPT_MAX_LENGTH}
          />
          {hasSubmitted && !prompt.trim() && (
            <div className="form-error">Prompt is required.</div>
          )}
        </div>
        <div className="form-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={!name.trim() || !prompt.trim() || submitting}
          >
            {submitting ? submittingLabel : submitLabel}
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}
      </form>
    </Modal>
  );
}
