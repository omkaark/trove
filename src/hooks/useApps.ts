import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  AppMetadata,
  GenerationComplete,
  GenerationError,
} from "../types";
import { upsertApp } from "../utils/apps";

type ErrorSource =
  | "load"
  | "generation"
  | "delete"
  | "listeners"
  | "export"
  | null;

type GenerationRequest = {
  id?: string;
  name: string;
  prompt: string;
  emoji: string;
  backgroundColor: string;
  mode: "create" | "edit";
};

export function useApps() {
  const [apps, setApps] = useState<AppMetadata[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorSource, setErrorSource] = useState<ErrorSource>(null);
  const [lastGenerationRequest, setLastGenerationRequest] =
    useState<GenerationRequest | null>(null);
  const appPathCache = useRef<Map<string, string>>(new Map());

  const setErrorWithSource = useCallback(
    (value: string | null, source: ErrorSource = null) => {
      setError(value);
      setErrorSource(value ? source : null);
    },
    []
  );

  const loadApps = useCallback(async () => {
    setIsLoading(true);
    try {
      const appsList = await invoke<AppMetadata[]>("list_apps");
      setApps(appsList);
    } catch (err) {
      setErrorWithSource(String(err), "load");
    } finally {
      setIsLoading(false);
    }
  }, [setErrorWithSource]);

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  useEffect(() => {
    let isActive = true;
    let cleanedUp = false;
    const unlisteners: UnlistenFn[] = [];
    const currentWindow = getCurrentWindow();

    const setupListeners = async () => {
      const registerListener = async <T>(
        eventName: string,
        handler: (event: { payload: T }) => void
      ) => {
        const unlisten = await currentWindow.listen<T>(eventName, handler);
        if (cleanedUp) {
          unlisten();
          return;
        }
        unlisteners.push(unlisten);
      };

      try {
        await registerListener<GenerationComplete>(
          "generation-complete",
          (event) => {
            setApps((prev) => upsertApp(prev, event.payload.app));
            setSelectedAppId(event.payload.app.id);
            setIsGenerating(false);
          }
        );

        await registerListener<GenerationError>(
          "generation-error",
          (event) => {
            setErrorWithSource(event.payload.message, "generation");
            setIsGenerating(false);
          }
        );
      } catch (err) {
        if (isActive) {
          setErrorWithSource(String(err), "listeners");
        }
      }
    };

    const setupPromise = setupListeners();

    return () => {
      isActive = false;
      cleanedUp = true;
      unlisteners.forEach((unlisten) => unlisten());
      unlisteners.length = 0;
      void setupPromise.finally(() => {
        if (cleanedUp) {
          unlisteners.forEach((unlisten) => unlisten());
        }
      });
    };
  }, []);

  const generateApp = useCallback(async (name: string, prompt: string, emoji: string, backgroundColor: string) => {
    setIsGenerating(true);
    setErrorWithSource(null);
    setLastGenerationRequest({ name, prompt, emoji, backgroundColor, mode: "create" });

    try {
      const app = await invoke<AppMetadata>("generate_app", { name, prompt, emoji, backgroundColor });
      return app;
    } catch (err) {
      setErrorWithSource(String(err), "generation");
      setIsGenerating(false);
      throw err;
    }
  }, [setErrorWithSource]);

  const cancelGeneration = useCallback(async () => {
    try {
      await invoke("cancel_generation");
      setIsGenerating(false);
    } catch (err) {
      console.error("Failed to cancel generation:", err);
    }
  }, []);

  const deleteApp = useCallback(
    async (id: string) => {
      try {
        await invoke("delete_app", { id });
        setApps((prev) => prev.filter((app) => app.id !== id));
        if (selectedAppId === id) {
          setSelectedAppId(null);
        }
        appPathCache.current.delete(id);
      } catch (err) {
        setErrorWithSource(String(err), "delete");
      }
    },
    [selectedAppId, setErrorWithSource]
  );

  const editApp = useCallback(
    async (id: string, name: string, prompt: string, emoji: string, backgroundColor: string) => {
      setIsGenerating(true);
      setErrorWithSource(null);
      setLastGenerationRequest({ id, name, prompt, emoji, backgroundColor, mode: "edit" });

      try {
        const app = await invoke<AppMetadata>("edit_app", { id, name, prompt, emoji, backgroundColor });
        return app;
      } catch (err) {
        setErrorWithSource(String(err), "generation");
        setIsGenerating(false);
        throw err;
      }
    },
    [setErrorWithSource]
  );

  const getAppPath = useCallback(async (id: string): Promise<string> => {
    const cached = appPathCache.current.get(id);
    if (cached) {
      return cached;
    }
    const path = await invoke<string>("get_app_path", { id });
    appPathCache.current.set(id, path);
    return path;
  }, []);

  const updateAppMetadata = useCallback(
    async (id: string, name: string, emoji: string, backgroundColor: string) => {
      try {
        const app = await invoke<AppMetadata>("update_app_metadata", {
          id,
          name,
          emoji,
          backgroundColor,
        });
        setApps((prev) => upsertApp(prev, app));
        return app;
      } catch (err) {
        setErrorWithSource(String(err), "generation");
        throw err;
      }
    },
    [setErrorWithSource]
  );

  const retryLastGeneration = useCallback(async () => {
    if (!lastGenerationRequest) return null;
    if (lastGenerationRequest.mode === "edit" && lastGenerationRequest.id) {
      return editApp(
        lastGenerationRequest.id,
        lastGenerationRequest.name,
        lastGenerationRequest.prompt,
        lastGenerationRequest.emoji,
        lastGenerationRequest.backgroundColor
      );
    }
    return generateApp(
      lastGenerationRequest.name,
      lastGenerationRequest.prompt,
      lastGenerationRequest.emoji,
      lastGenerationRequest.backgroundColor
    );
  }, [editApp, generateApp, lastGenerationRequest]);

  const selectedApp = apps.find((app) => app.id === selectedAppId) || null;

  return {
    apps,
    selectedApp,
    setSelectedAppId,
    isLoading,
    isGenerating,
    error,
    setError: setErrorWithSource,
    errorSource,
    lastGenerationRequest,
    generateApp,
    cancelGeneration,
    deleteApp,
    editApp,
    updateAppMetadata,
    retryLastGeneration,
    getAppPath,
  };
}
