import { useCallback, useEffect, useMemo, useState } from "react";
import { useApps } from "./hooks/useApps";
import { Sidebar } from "./components/Sidebar";
import { ContentArea } from "./components/ContentArea";
import { AppFormModal } from "./components/AppFormModal";
import { ConfirmModal } from "./components/ConfirmModal";
import { KeyboardShortcutsModal } from "./components/KeyboardShortcutsModal";
import "./App.css";

function formatError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (typeof err === "string" && err.trim()) {
    return err;
  }
  return fallback;
}

function App() {
  const {
    apps,
    selectedApp,
    setSelectedAppId,
    isLoading,
    isGenerating,
    error,
    setError,
    errorSource,
    lastGenerationRequest,
    generateApp,
    cancelGeneration,
    deleteApp,
    editApp,
    updateAppMetadata,
    retryLastGeneration,
    getAppPath,
  } = useApps();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [appToEdit, setAppToEdit] = useState<typeof selectedApp>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const handleNewApp = useCallback(() => {
    if (!isGenerating) {
      setIsModalOpen(true);
    }
  }, [isGenerating]);

  const handleModalClose = () => setIsModalOpen(false);
  const handleOpenShortcuts = () => setIsShortcutsOpen(true);
  const handleCloseShortcuts = () => setIsShortcutsOpen(false);

  const handleModalSubmit = async (name: string, prompt: string, emoji: string, backgroundColor: string) => {
    setIsModalOpen(false);
    try {
      await generateApp(name, prompt, emoji, backgroundColor);
    } catch (err) {
      setError(formatError(err, "Failed to generate app"), "generation");
    }
  };

  const handleDeleteApp = useCallback((id: string) => {
    setPendingDeleteId(id);
  }, []);

  const pendingDeleteApp = apps.find((app) => app.id === pendingDeleteId) || null;

  const handleConfirmDelete = async () => {
    if (!pendingDeleteId) return;
    await deleteApp(pendingDeleteId);
    setPendingDeleteId(null);
  };

  const handleCancelDelete = useCallback(() => {
    setPendingDeleteId(null);
  }, []);

  const handleEditOpen = useCallback(() => {
    if (selectedApp) {
      setAppToEdit(selectedApp);
      setEditError(null);
    }
  }, [selectedApp]);

  const handleEditClose = useCallback(() => {
    setAppToEdit(null);
    setEditError(null);
    setIsEditing(false);
  }, []);

  const handleEditSubmit = async (name: string, prompt: string, emoji: string, backgroundColor: string) => {
    if (!appToEdit) return;

    const promptChanged = prompt.trim() !== appToEdit.prompt.trim();
    setAppToEdit(null);
    setEditError(null);

    try {
      if (promptChanged) {
        // Prompt changed - need to regenerate
        await editApp(appToEdit.id, name, prompt, emoji, backgroundColor);
      } else {
        // Only metadata changed - quick update
        await updateAppMetadata(appToEdit.id, name, emoji, backgroundColor);
      }
    } catch (err) {
      setError(formatError(err, "Failed to update app"), "generation");
    }
  };

  const handleRetryGeneration = async () => {
    try {
      await retryLastGeneration();
    } catch (err) {
      setError(formatError(err, "Failed to retry generation"), "generation");
    }
  };

  const visibleApps = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? apps.filter(
          (app) =>
            app.name.toLowerCase().includes(query) ||
            app.prompt.toLowerCase().includes(query)
        )
      : apps;

    return filtered;
  }, [apps, searchQuery]);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        target.isContentEditable ||
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT"
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (pendingDeleteId) {
          event.preventDefault();
          handleCancelDelete();
          return;
        }
        if (isShortcutsOpen) {
          event.preventDefault();
          handleCloseShortcuts();
          return;
        }
        if (appToEdit) {
          event.preventDefault();
          handleEditClose();
          return;
        }
        if (isModalOpen) {
          event.preventDefault();
          handleModalClose();
        }
        return;
      }

      if (isTypingTarget(event.target)) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        handleNewApp();
        return;
      }

      if (
        (event.metaKey || event.ctrlKey) &&
        (event.key === "Backspace" || event.key === "Delete")
      ) {
        if (selectedApp) {
          event.preventDefault();
          handleDeleteApp(selectedApp.id);
        }
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!visibleApps.length) return;
        event.preventDefault();
        const currentIndex = visibleApps.findIndex(
          (app) => app.id === selectedApp?.id
        );
        const nextIndex =
          event.key === "ArrowDown"
            ? Math.min(
                currentIndex === -1 ? 0 : currentIndex + 1,
                visibleApps.length - 1
              )
            : Math.max(currentIndex === -1 ? visibleApps.length - 1 : currentIndex - 1, 0);
        setSelectedAppId(visibleApps[nextIndex].id);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    handleNewApp,
    handleModalClose,
    handleCancelDelete,
    handleCloseShortcuts,
    handleEditClose,
    isModalOpen,
    isShortcutsOpen,
    appToEdit,
    pendingDeleteId,
    visibleApps,
    selectedApp,
    handleDeleteApp,
    setSelectedAppId,
  ]);

  return (
    <div className="app-container">
      <Sidebar
        apps={visibleApps}
        selectedAppId={selectedApp?.id ?? null}
        onSelectApp={setSelectedAppId}
        onDeleteApp={handleDeleteApp}
        onNewApp={handleNewApp}
        onShowShortcuts={handleOpenShortcuts}
        isGenerating={isGenerating}
        isLoading={isLoading}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
      />
      <ContentArea
        app={selectedApp}
        getAppPath={getAppPath}
        isGenerating={isGenerating}
        onCancelGeneration={cancelGeneration}
        onNewApp={handleNewApp}
        onEditApp={handleEditOpen}
      />
      <AppFormModal
        mode="new"
        isOpen={isModalOpen}
        onClose={handleModalClose}
        onSubmit={handleModalSubmit}
      />
      <ConfirmModal
        isOpen={Boolean(pendingDeleteId)}
        appName="Delete app?"
        message={
          pendingDeleteApp
            ? `This will permanently delete "${pendingDeleteApp.name}".`
            : "This will permanently delete this app."
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
      <KeyboardShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={handleCloseShortcuts}
      />
      <AppFormModal
        mode="edit"
        isOpen={Boolean(appToEdit)}
        app={appToEdit}
        isSubmitting={isEditing}
        error={editError}
        onClose={handleEditClose}
        onSubmit={handleEditSubmit}
      />
      {error && (
        <div className="error-toast" role="alert" aria-live="assertive">
          <span>{error}</span>
          <div className="error-actions">
            {errorSource === "generation" && lastGenerationRequest && !isGenerating && (
              <button className="error-retry" onClick={handleRetryGeneration}>
                Retry
              </button>
            )}
            <button
              className="error-close"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              &times;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
