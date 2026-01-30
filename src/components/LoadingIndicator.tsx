import "./LoadingIndicator.css";

interface LoadingIndicatorProps {
  onCancel: () => void;
}

const LOADER_CELLS = [
  "slot-0",
  "slot-1",
  "slot-2",
  "slot-3",
  "slot-4",
  "slot-5",
  "slot-6",
  "slot-7",
  "slot-8",
] as const;

export function LoadingIndicator({ onCancel }: LoadingIndicatorProps) {
  return (
    <div className="loading-indicator">
      <div className="loading-grid-loader" aria-hidden="true">
        {LOADER_CELLS.map((cellClass) => (
          <div key={cellClass} className={`loading-cell ${cellClass}`} />
        ))}
      </div>

      <button className="cancel-button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
