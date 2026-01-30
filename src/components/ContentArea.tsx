import { useEffect, useState, useRef, useCallback } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AppMetadata } from "../types";
import { EmptyState } from "./EmptyState";
import { LoadingIndicator } from "./LoadingIndicator";
import "./ContentArea.css";

const DEFAULT_EMOJI = "✨";
const DEFAULT_COLOR = "#6366F1";

const startDrag = (e: React.MouseEvent) => {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement;
  if (target.closest("button, input, a, textarea, select")) return;
  e.preventDefault();
  getCurrentWindow().startDragging();
};

interface ContentAreaProps {
  app: AppMetadata | null;
  getAppPath: (id: string) => Promise<string>;
  isGenerating: boolean;
  onCancelGeneration: () => void;
  onNewApp: () => void;
  onEditApp: () => void;
}

export function ContentArea({
  app,
  getAppPath,
  isGenerating,
  onCancelGeneration,
  onNewApp,
  onEditApp,
}: ContentAreaProps) {
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const [isLoadingApp, setIsLoadingApp] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleStorageMessage = useCallback(
    async (event: MessageEvent) => {
      if (!app || !iframeRef.current) return;

      const data = event.data;
      if (data?.type !== "trove-storage") return;

      const { requestId, action, key, value } = data;
      const appId = app.id;

      try {
        let result: unknown = null;

        switch (action) {
          case "get":
            result = await invoke("storage_get", { appId, key });
            break;
          case "set":
            await invoke("storage_set", { appId, key, value });
            break;
          case "delete":
            await invoke("storage_delete", { appId, key });
            break;
          case "clear":
            await invoke("storage_clear", { appId });
            break;
          case "getAll":
            result = await invoke("storage_get_all", { appId });
            break;
          default:
            throw new Error(`Unknown storage action: ${action}`);
        }

        iframeRef.current.contentWindow?.postMessage(
          { type: "trove-storage-response", requestId, success: true, result },
          "*"
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        iframeRef.current.contentWindow?.postMessage(
          { type: "trove-storage-response", requestId, success: false, error: message },
          "*"
        );
      }
    },
    [app]
  );

  useEffect(() => {
    window.addEventListener("message", handleStorageMessage);
    return () => window.removeEventListener("message", handleStorageMessage);
  }, [handleStorageMessage]);

  useEffect(() => {
    if (!app) {
      setIframeSrc(null);
      setLoadError(null);
      setIsLoadingApp(false);
      return;
    }

    let cancelled = false;
    const appId = app.id;
    setIsLoadingApp(true);
    setLoadError(null);
    getAppPath(appId)
      .then((path) => {
        if (cancelled) return;
        const assetUrl = convertFileSrc(path);
        setIframeSrc(assetUrl);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to get app path:", err);
        setLoadError("Failed to load app preview.");
        setIframeSrc(null);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingApp(false);
      });

    return () => {
      cancelled = true;
    };
  }, [app, getAppPath, reloadToken]);

  if (isGenerating) {
    return (
      <div className="content-area content-area-center">
        <div className="content-drag-region" onMouseDown={startDrag} />
        <LoadingIndicator onCancel={onCancelGeneration} />
      </div>
    );
  }

  if (!app) {
    return (
      <div className="content-area content-area-center">
        <div className="content-drag-region" onMouseDown={startDrag} />
        <EmptyState onNewApp={onNewApp} />
      </div>
    );
  }

  if (isLoadingApp) {
    return (
      <div className="content-area content-area-center">
        <div className="content-drag-region" onMouseDown={startDrag} />
        <div className="loading-app">Loading app...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="content-area content-area-center">
        <div className="content-drag-region" onMouseDown={startDrag} />
        <div className="loading-app">
          {loadError}
          <button
            className="content-action-button"
            onClick={() => setReloadToken((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const emoji = app.emoji || DEFAULT_EMOJI;
  const backgroundColor = app.background_color || DEFAULT_COLOR;

  return (
    <div className="content-area">
      <div className="content-area-header" onMouseDown={startDrag}>
        <div className="content-area-header-left">
          <span className="content-area-icon" style={{ backgroundColor }}>
            <span className="content-area-emoji">{emoji}</span>
          </span>
          <div className="content-area-appName">
            <span className="content-area-name">{app.name}</span>
            <span className="content-area-subtitle">
              Last updated {formatRelativeTime(app.updated_at)}
            </span>
          </div>
        </div>
        <div className="content-area-actions">
          <button
            className="content-icon-button"
            onClick={onEditApp}
            title="Settings"
            aria-label="App settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
      </div>
      {iframeSrc && (
        <iframe
          ref={iframeRef}
          key={app.id}
          src={iframeSrc}
          className="app-iframe"
          sandbox="allow-scripts allow-same-origin"
          title={app.name}
        />
      )}
    </div>
  );
}

function formatRelativeTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? "" : "s"} ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}
