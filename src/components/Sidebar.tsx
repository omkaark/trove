import { useCallback, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AppMetadata } from "../types";
import { SidebarItem } from "./SidebarItem";
import "./Sidebar.css";

const startDrag = (e: React.MouseEvent) => {
  // Only drag on left click and not on interactive elements
  if (e.button !== 0) return;
  const target = e.target as HTMLElement;
  if (target.closest("button, input, a, textarea, select")) return;
  e.preventDefault();
  getCurrentWindow().startDragging();
};

interface SidebarProps {
  apps: AppMetadata[];
  selectedAppId: string | null;
  onSelectApp: (id: string) => void;
  onDeleteApp: (id: string) => void;
  onNewApp: () => void;
  onShowShortcuts: () => void;
  isGenerating: boolean;
  isLoading: boolean;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
}

const MIN_WIDTH = 220;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 280;

export function Sidebar({
  apps,
  selectedAppId,
  onSelectApp,
  onDeleteApp,
  onNewApp,
  onShowShortcuts,
  isGenerating,
  isLoading,
  searchQuery,
  onSearchQueryChange,
}: SidebarProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const isResizing = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  return (
    <div className="sidebar" style={{ width }}>
      <div className="sidebar-drag-region" onMouseDown={startDrag} />

      <div className="sidebar-content">
        <button
          className="create-app-button"
          onClick={onNewApp}
          disabled={isGenerating}
        >
          <span className="create-app-icon">+</span>
          <span>Create new app</span>
        </button>

        <div className="sidebar-section">
          <span className="sidebar-section-label">YOUR APPS</span>
          <input
            className="sidebar-search"
            type="text"
            placeholder="Search apps..."
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
          />
        </div>

        {isLoading ? (
          <div className="sidebar-loading">
            {Array.from({ length: 4 }).map((_, index) => (
              <div className="sidebar-skeleton-item" key={`skeleton-${index}`}>
                <span className="skeleton-icon" />
                <span className="skeleton-line short" />
                <span className="skeleton-line" />
              </div>
            ))}
          </div>
        ) : apps.length === 0 ? (
          <div className="sidebar-empty">
            <p>{searchQuery ? "No matching apps" : "No apps yet"}</p>
            <p className="sidebar-empty-hint">
              {searchQuery ? "Try a different search term" : "Click the button above to create one"}
            </p>
          </div>
        ) : (
          <div className="app-list">
            {apps.map((app) => (
              <SidebarItem
                key={app.id}
                app={app}
                isSelected={app.id === selectedAppId}
                onSelect={() => onSelectApp(app.id)}
                onDelete={() => onDeleteApp(app.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <button
          className="help-button"
          onClick={onShowShortcuts}
          title="Keyboard shortcuts"
          aria-label="Keyboard shortcuts"
        >
          ?
        </button>
      </div>

      <div
        className="sidebar-resize-handle"
        onMouseDown={handleMouseDown}
      />
    </div>
  );
}
