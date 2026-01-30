import { useState } from "react";
import type { AppMetadata } from "../types";
import "./SidebarItem.css";

const DEFAULT_EMOJI = "✨";
const DEFAULT_COLOR = "#6366F1";

interface SidebarItemProps {
  app: AppMetadata;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

export function SidebarItem({
  app,
  isSelected,
  onSelect,
  onDelete,
}: SidebarItemProps) {
  const [showDelete, setShowDelete] = useState(false);

  const emoji = app.emoji || DEFAULT_EMOJI;
  const backgroundColor = app.background_color || DEFAULT_COLOR;
  const promptSnippet = truncate(app.prompt || "", 60);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  };

  return (
    <div
      className={`sidebar-item ${isSelected ? "selected" : ""}`}
      onClick={onSelect}
      onMouseEnter={() => setShowDelete(true)}
      onMouseLeave={() => setShowDelete(false)}
    >
      <span className="sidebar-item-icon" style={{ backgroundColor }}>
        <span className="sidebar-item-emoji">{emoji}</span>
      </span>
      <div className="sidebar-item-text">
        <span className="sidebar-item-name">{app.name}</span>
        <span className="sidebar-item-meta">{promptSnippet}</span>
      </div>
      {showDelete && (
        <button
          className="sidebar-item-delete"
          onClick={handleDelete}
          title="Delete app"
          aria-label={`Delete ${app.name}`}
        >
          &times;
        </button>
      )}
    </div>
  );
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}
