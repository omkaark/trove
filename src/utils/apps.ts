import type { AppMetadata } from "../types";

export function upsertApp(
  apps: AppMetadata[],
  app: AppMetadata
): AppMetadata[] {
  const index = apps.findIndex((existing) => existing.id === app.id);
  if (index === -1) {
    return [...apps, app];
  }
  const next = [...apps];
  next[index] = app;
  return next;
}
