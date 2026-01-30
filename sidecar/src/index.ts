#!/usr/bin/env node

import { query } from "@anthropic-ai/claude-agent-sdk";
import { execFileSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join, resolve, relative, sep, isAbsolute } from "node:path";

const SYSTEM_PROMPT = `You are an expert web developer. Your task is to generate a single, self-contained HTML file that implements the user's request.

IMPORTANT REQUIREMENTS:
1. Output ONLY valid HTML - no explanations, markdown, or code blocks
2. The HTML must be completely self-contained with all CSS in <style> tags and all JS in <script> tags
3. Use modern CSS (flexbox, grid, custom properties) and vanilla JavaScript
4. Make the app responsive and visually appealing
5. Include proper error handling in JavaScript
6. The app should work offline without any external dependencies
7. Use a clean, minimalist, modern design with good typography and spacing

DATA PERSISTENCE:
If the app needs to save data between sessions, use the TroveStorage API (already available globally):
- await TroveStorage.get(key) - Returns the stored value or null
- await TroveStorage.set(key, value) - Stores any JSON-serializable value
- await TroveStorage.delete(key) - Removes a key
- await TroveStorage.clear() - Removes all stored data
- await TroveStorage.getAll() - Returns all key-value pairs as an object

Example usage:
  // Load saved data on startup
  const todos = await TroveStorage.get('todos') || [];

  // Save when data changes
  await TroveStorage.set('todos', todos);

DO NOT use localStorage or sessionStorage - they won't persist. Use TroveStorage instead.

Start your response directly with <!DOCTYPE html> and end with </html>.`;

const TROVE_STORAGE_SCRIPT = `
<script>
(function() {
  var TIMEOUT_MS = 5000;
  var pendingRequests = new Map();
  var requestIdCounter = 0;

  window.addEventListener('message', function(event) {
    var data = event.data;
    if (data?.type !== 'trove-storage-response') return;

    var request = pendingRequests.get(data.requestId);
    if (!request) return;

    clearTimeout(request.timeoutId);
    pendingRequests.delete(data.requestId);
    if (data.success) {
      request.resolve(data.result);
    } else {
      request.reject(new Error(data.error));
    }
  });

  function sendRequest(action, key, value) {
    return new Promise(function(resolve, reject) {
      var requestId = ++requestIdCounter;
      var timeoutId = setTimeout(function() {
        pendingRequests.delete(requestId);
        reject(new Error('TroveStorage: operation timed out'));
      }, TIMEOUT_MS);

      pendingRequests.set(requestId, { resolve: resolve, reject: reject, timeoutId: timeoutId });
      window.parent.postMessage(
        { type: 'trove-storage', requestId: requestId, action: action, key: key, value: value },
        '*'
      );
    });
  }

  window.TroveStorage = {
    get: function(key) { return sendRequest('get', key); },
    set: function(key, value) { return sendRequest('set', key, value); },
    delete: function(key) { return sendRequest('delete', key); },
    clear: function() { return sendRequest('clear'); },
    getAll: function() { return sendRequest('getAll'); }
  };
})();
</script>
`;

type ClaudeTextBlock = {
  type: "text";
  text: string;
};

let activeQuery: { close(): void } | null = null;
let activeAbortController: AbortController | null = null;

/**
 * Narrow unknown values to record objects.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Extract the top-level message type.
 */
function getType(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const type = value.type;
  return typeof type === "string" ? type : null;
}

/**
 * Extract the assistant content array, if present.
 */
function getMessageContent(value: unknown): unknown[] | null {
  if (!isRecord(value)) return null;
  const message = value.message;
  if (!isRecord(message)) return null;
  const content = message.content;
  return Array.isArray(content) ? content : null;
}

/**
 * Type guard for text blocks returned by the SDK.
 */
function isTextBlock(value: unknown): value is ClaudeTextBlock {
  return (
    isRecord(value) && value.type === "text" && typeof value.text === "string"
  );
}

/**
 * Extract the result text from a result message, if present.
 */
function getResultText(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const result = value.result;
  return typeof result === "string" ? result : null;
}

/**
 * Exits the process after cleaning up any in-flight query.
 */
function exitWithError(message: string): never {
  const normalized = message.startsWith("ERROR:") ? message.slice(6) : message;
  if (activeAbortController) {
    activeAbortController.abort();
  }
  if (activeQuery) {
    activeQuery.close();
  }
  console.log(`ERROR:${normalized}`);
  process.exit(1);
}

/**
 * Injects the TroveStorage API script into the HTML head.
 */
function injectTroveStorage(html: string): string {
  const headCloseIndex = html.toLowerCase().indexOf('</head>');
  if (headCloseIndex === -1) {
    return html;
  }
  return (
    html.slice(0, headCloseIndex) +
    TROVE_STORAGE_SCRIPT +
    html.slice(headCloseIndex)
  );
}

/**
 * Validates basic structural HTML requirements for generated output.
 */
function validateHtml(html: string): string | null {
  const lower = html.toLowerCase();
  const doctypeIndex = lower.indexOf("<!doctype");
  const htmlOpen = lower.indexOf("<html");
  const htmlClose = lower.lastIndexOf("</html>");
  const headOpen = lower.indexOf("<head");
  const headClose = lower.indexOf("</head>");
  const bodyOpen = lower.indexOf("<body");
  const bodyClose = lower.lastIndexOf("</body>");

  if (htmlOpen === -1 || htmlClose === -1 || htmlClose < htmlOpen) {
    return "Generated content is missing a valid <html> structure";
  }
  if (doctypeIndex !== -1 && doctypeIndex > htmlOpen) {
    return "DOCTYPE must appear before <html>";
  }
  if (headOpen === -1 || headClose === -1 || headClose < headOpen) {
    return "Generated content is missing a valid <head> section";
  }
  if (bodyOpen === -1 || bodyClose === -1 || bodyClose < bodyOpen) {
    return "Generated content is missing a valid <body> section";
  }
  if (bodyClose > htmlClose) {
    return "HTML body must close before </html>";
  }
  return null;
}

/**
 * Checks whether a path is executable.
 */
function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves an executable by scanning a PATH-like string.
 */
function findExecutableInPath(pathValue: string | undefined, exeName: string): string | undefined {
  if (!pathValue) return undefined;
  for (const dir of pathValue.split(delimiter)) {
    const candidate = join(dir, exeName);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Attempts to locate Claude via a login shell, which can include user PATH setup.
 */
function findClaudeViaLoginShell(): string | undefined {
  const shellCandidates = [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"];
  const tried = new Set<string>();

  for (const shellPath of shellCandidates) {
    if (!shellPath || tried.has(shellPath)) continue;
    tried.add(shellPath);

    try {
      const output = execFileSync(shellPath, ["-lc", "command -v claude"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();

      if (!output) continue;
      const resolved = output.split(/\r?\n/)[0]?.trim() || "";
      if (resolved && isExecutable(resolved)) {
        return resolved;
      }
    } catch {
      // Ignore shell lookup failures and continue with other options.
    }
  }

  return undefined;
}

/**
 * Resolves the Claude Code CLI executable path from env or PATH.
 */
function findClaudeExecutable(): string | undefined {
  const envPath = process.env.CLAUDE_CODE_PATH || process.env.CLAUDE_PATH;
  if (envPath && isExecutable(envPath)) {
    return envPath;
  }

  const exeName = "claude";
  const fromPath = findExecutableInPath(process.env.PATH, exeName);
  if (fromPath) {
    return fromPath;
  }

  const home = process.env.HOME;
  const fallbackCandidates: string[] = [];

  fallbackCandidates.push("/opt/homebrew/bin/claude");
  fallbackCandidates.push("/usr/local/bin/claude");
  fallbackCandidates.push("/usr/bin/claude");
  if (home) {
    fallbackCandidates.push(join(home, ".local", "bin", "claude"));
  }

  for (const candidate of fallbackCandidates) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return findClaudeViaLoginShell();
}

async function main() {
  if (process.platform !== "darwin") {
    exitWithError("Trove sidecar currently supports macOS only");
  }

  const args = process.argv.slice(2);
  let existingHtmlPath: string | null = null;
  let appsDirPath: string | null = null;
  let modelOverride: string | null = null;
  let maxTurnsOverride: number | null = null;
  let timeoutOverride: number | null = null;
  const filteredArgs: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--edit") {
      const next = args[i + 1];
      if (!next) {
        exitWithError("Missing path after --edit");
      }
      existingHtmlPath = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--edit=")) {
      existingHtmlPath = arg.slice("--edit=".length);
      continue;
    }
    if (arg === "--apps-dir") {
      const next = args[i + 1];
      if (!next) {
        exitWithError("Missing path after --apps-dir");
      }
      appsDirPath = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--apps-dir=")) {
      appsDirPath = arg.slice("--apps-dir=".length);
      continue;
    }
    if (arg === "--model") {
      const next = args[i + 1];
      if (!next) {
        exitWithError("Missing value after --model");
      }
      modelOverride = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--model=")) {
      modelOverride = arg.slice("--model=".length);
      continue;
    }
    if (arg === "--max-turns") {
      const next = args[i + 1];
      if (!next) {
        exitWithError("Missing value after --max-turns");
      }
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        exitWithError("--max-turns must be a positive integer");
      }
      maxTurnsOverride = parsed;
      i += 1;
      continue;
    }
    if (arg.startsWith("--max-turns=")) {
      const parsed = Number.parseInt(arg.slice("--max-turns=".length), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        exitWithError("--max-turns must be a positive integer");
      }
      maxTurnsOverride = parsed;
      continue;
    }
    if (arg === "--timeout-ms") {
      const next = args[i + 1];
      if (!next) {
        exitWithError("Missing value after --timeout-ms");
      }
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        exitWithError("--timeout-ms must be a positive integer");
      }
      timeoutOverride = parsed;
      i += 1;
      continue;
    }
    if (arg.startsWith("--timeout-ms=")) {
      const parsed = Number.parseInt(arg.slice("--timeout-ms=".length), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        exitWithError("--timeout-ms must be a positive integer");
      }
      timeoutOverride = parsed;
      continue;
    }
    filteredArgs.push(arg);
  }

  if (existingHtmlPath && !appsDirPath) {
    exitWithError("--apps-dir is required when using --edit");
  }

  if (filteredArgs.length < 2) {
    exitWithError(
      "Usage: trove-sidecar [--edit <html-path> --apps-dir <dir>] [--model <name>] [--max-turns <n>] [--timeout-ms <ms>] <name> <prompt>"
    );
  }

  const [name, ...promptParts] = filteredArgs;
  const prompt = promptParts.join(" ");

  console.log("PROGRESS:Initializing AI agent...");

  try {
    console.log(`PROGRESS:Generating "${name}"...`);

    const editMode = Boolean(existingHtmlPath);
    let resolvedHtmlPath: string | null = null;
    let resolvedAppsDir: string | null = null;

    if (editMode) {
      resolvedHtmlPath = resolve(existingHtmlPath ?? "");
      resolvedAppsDir = resolve(appsDirPath ?? "");
      const rel = relative(resolvedAppsDir, resolvedHtmlPath);
      if (rel.startsWith("..") || rel.startsWith(sep) || isAbsolute(rel)) {
        exitWithError("Edit path is outside of apps directory");
      }

      try {
        const stats = statSync(resolvedHtmlPath);
        if (!stats.isFile() || !resolvedHtmlPath.endsWith(".html")) {
          exitWithError("Edit path must be an existing .html file");
        }
      } catch {
        exitWithError("Edit path must be an existing .html file");
      }
    }

    const baseInstruction = editMode
      ? `Update the existing app "${name}" based on the current HTML file at "${resolvedHtmlPath}". Use the Read tool to inspect the existing file before making changes. Apply the new requirements below while preserving working parts unless they conflict.`
      : `Create a web app called "${name}" with the following functionality:`;

    const userPrompt = `${baseInstruction}\n\n${prompt}\n\nRemember: Output ONLY the complete HTML file, starting with <!DOCTYPE html> and ending with </html>.`;

    let htmlContent = "";
    let started = false;

    console.log("PROGRESS:AI is generating your app...");

    const claudePath = findClaudeExecutable();
    if (!claudePath) {
      exitWithError(
        "Claude Code CLI not found. Install it or set CLAUDE_CODE_PATH to the executable path."
      );
    }

    const envModel = process.env.TROVE_CLAUDE_MODEL;
    const envMaxTurns = process.env.TROVE_CLAUDE_MAX_TURNS;
    const envTimeout = process.env.TROVE_CLAUDE_TIMEOUT_MS;
    const resolvedModel = modelOverride ?? envModel ?? "sonnet";
    const resolvedMaxTurns = maxTurnsOverride
      ?? (envMaxTurns ? Number.parseInt(envMaxTurns, 10) : null)
      ?? 3;
    if (!Number.isFinite(resolvedMaxTurns) || resolvedMaxTurns <= 0) {
      exitWithError("Max turns must be a positive integer");
    }
    const resolvedTimeoutMs = timeoutOverride
      ?? (envTimeout ? Number.parseInt(envTimeout, 10) : null)
      ?? 180000;
    if (!Number.isFinite(resolvedTimeoutMs) || resolvedTimeoutMs <= 0) {
      exitWithError("Timeout must be a positive integer");
    }

    const abortController = new AbortController();
    activeAbortController = abortController;

    const queryOptions = {
      model: resolvedModel,
      systemPrompt: SYSTEM_PROMPT,
      maxTurns: resolvedMaxTurns,
      allowedTools: editMode ? ["Read"] : [],
      cwd: editMode ? resolvedAppsDir ?? undefined : undefined,
      additionalDirectories: editMode && resolvedAppsDir ? [resolvedAppsDir] : undefined,
      pathToClaudeCodeExecutable: claudePath,
      abortController,
    };

    const queryHandle = query({
      prompt: userPrompt,
      options: queryOptions,
    });
    activeQuery = queryHandle;

    const timeoutId = setTimeout(() => {
      abortController.abort();
      queryHandle.close();
    }, resolvedTimeoutMs);

    try {
      for await (const message of queryHandle) {
        const messageType = getType(message);
        if (messageType === "assistant") {
          const content = getMessageContent(message);
          if (content) {
            for (const block of content) {
              if (isTextBlock(block)) {
                htmlContent += block.text;
                if (!started && htmlContent.includes("<!DOCTYPE")) {
                  started = true;
                  console.log("PROGRESS:Receiving HTML content...");
                }
              }
            }
          }
        } else if (messageType === "result") {
          const result = getResultText(message);
          if (result && !htmlContent) {
            htmlContent = result;
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        exitWithError(
          `Generation timed out after ${Math.round(resolvedTimeoutMs / 1000)}s`
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      activeQuery = null;
      activeAbortController = null;
    }

    htmlContent = htmlContent.trim();

    if (!htmlContent.startsWith("<!DOCTYPE") && !htmlContent.startsWith("<html")) {
      const docTypeIndex = htmlContent.indexOf("<!DOCTYPE");
      const htmlIndex = htmlContent.indexOf("<html");
      const startIndex = docTypeIndex !== -1 ? docTypeIndex : htmlIndex;

      if (startIndex !== -1) {
        htmlContent = htmlContent.substring(startIndex);
      }
    }

    const htmlEndIndex = htmlContent.lastIndexOf("</html>");
    if (htmlEndIndex !== -1) {
      htmlContent = htmlContent.substring(0, htmlEndIndex + 7);
    }

    if (!htmlContent.includes("<html") || !htmlContent.includes("</html>")) {
      exitWithError("Generated content is not valid HTML");
    }

    const validationError = validateHtml(htmlContent);
    if (validationError) {
      exitWithError(validationError);
    }

    // Inject TroveStorage API for data persistence
    htmlContent = injectTroveStorage(htmlContent);

    console.log("PROGRESS:Finalizing...");
    console.log("HTML_START");
    console.log(htmlContent);
    console.log("HTML_END");
    console.log("PROGRESS:Done!");

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    exitWithError(message);
  }
}

main();
