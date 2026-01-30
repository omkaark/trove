import type { FormEvent } from "react";
import { Modal } from "./Modal";

interface ConfirmModalProps {
  isOpen: boolean;
  appName: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  isOpen,
  appName,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const handleConfirm = (e: FormEvent) => {
    e.preventDefault();
    onConfirm();
  };

  return (
    <Modal isOpen={isOpen} onClose={onCancel}>
      <div className="modal-header">
        <h2>{appName}</h2>
        <button className="modal-close" onClick={onCancel}>
          &times;
        </button>
      </div>
      <form onSubmit={handleConfirm}>
        <div className="confirm-body">
          <p>{message}</p>
        </div>
        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="submit" className="btn-primary btn-danger">
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
