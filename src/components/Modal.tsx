import type { MouseEvent, PropsWithChildren } from "react";
import "./Modal.css";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  disableClose?: boolean;
}

export function Modal({
  isOpen,
  onClose,
  disableClose = false,
  children,
}: PropsWithChildren<ModalProps>) {
  if (!isOpen) return null;

  const handleOverlayClick = (event: MouseEvent<HTMLDivElement>) => {
    if (disableClose) return;
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal">{children}</div>
    </div>
  );
}
