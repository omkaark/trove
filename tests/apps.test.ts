import { describe, expect, it } from "vitest";
import { upsertApp } from "../src/utils/apps";
import type { AppMetadata } from "../src/types";

const makeApp = (overrides: Partial<AppMetadata> = {}): AppMetadata => ({
  id: "app-1",
  name: "Test App",
  prompt: "Test prompt",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  ...overrides,
});

describe("upsertApp", () => {
  it("adds a new app when id is not present", () => {
    const initial = [makeApp({ id: "app-1" })];
    const next = upsertApp(initial, makeApp({ id: "app-2" }));

    expect(next).toHaveLength(2);
    expect(next[1].id).toBe("app-2");
  });

  it("replaces the app when id matches", () => {
    const initial = [makeApp({ id: "app-1" })];
    const next = upsertApp(initial, makeApp({ id: "app-1", name: "Updated" }));

    expect(next).not.toBe(initial);
    expect(next).toHaveLength(1);
    expect(next[0].name).toBe("Updated");
  });
});
