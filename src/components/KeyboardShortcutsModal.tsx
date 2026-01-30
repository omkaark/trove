import { Modal } from "./Modal";
import "./KeyboardShortcutsModal.css";

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsModal({
  isOpen,
  onClose,
}: KeyboardShortcutsModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="modal-header">
        <h2>Keyboard shortcuts</h2>
        <button className="modal-close" onClick={onClose}>
          &times;
        </button>
      </div>
      <div className="shortcut-body">
        <div className="shortcut-row">
          <span className="shortcut-label">New app</span>
          <div className="shortcut-keys">
            <kbd>Cmd</kbd>
            <span className="shortcut-plus">+</span>
            <kbd>N</kbd>
            <span className="shortcut-or">or</span>
            <kbd>Ctrl</kbd>
            <span className="shortcut-plus">+</span>
            <kbd>N</kbd>
          </div>
        </div>
        <div className="shortcut-row">
          <span className="shortcut-label">Delete app</span>
          <div className="shortcut-keys">
            <kbd>Cmd</kbd>
            <span className="shortcut-plus">+</span>
            <kbd>Backspace</kbd>
            <span className="shortcut-or">or</span>
            <kbd>Ctrl</kbd>
            <span className="shortcut-plus">+</span>
            <kbd>Backspace</kbd>
          </div>
        </div>
        <div className="shortcut-row">
          <span className="shortcut-label">Navigate apps</span>
          <div className="shortcut-keys">
            <kbd>Up</kbd>
            <kbd>Down</kbd>
          </div>
        </div>
        <div className="shortcut-row">
          <span className="shortcut-label">Close modal</span>
          <div className="shortcut-keys">
            <kbd>Esc</kbd>
          </div>
        </div>
      </div>
    </Modal>
  );
}
