# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Trove is an AI-powered mini app generator built with Tauri, React, and TypeScript. Users provide a name and prompt, and the app generates self-contained HTML web applications using the Claude API.

## Build Commands

```bash
pnpm dev              # Start development (builds sidecar + Vite dev server + Tauri)
pnpm build            # Production build
pnpm build:sidecar    # Build sidecar CLI tool only
pnpm test             # Run vitest tests
pnpm tauri dev        # Run Tauri development mode
pnpm tauri build      # Build Tauri application for distribution
```

## Architecture

Three-layer architecture:

1. **Frontend (`/src`)** - React 19 UI with Tauri IPC
2. **Desktop Runtime (`/src-tauri`)** - Rust/Tauri backend handling filesystem, process management, and event emission
3. **Sidecar (`/sidecar`)** - TypeScript/Node.js CLI tool that calls Claude Agent SDK to generate HTML

### Data Flow for App Generation

```
UI → Tauri Command → Spawn Sidecar Process → Stream Stdout → Emit Events → Update UI
```

The sidecar outputs a specific protocol:
- `PROGRESS:` lines for status updates
- `HTML_START` / `HTML_END` markers around generated HTML
- `ERROR:` prefix for errors

### Storage

Apps stored at `~/Library/Application Support/com.omkaarwork.trove/apps/`:
- `apps.json` - Index of all app metadata
- `{uuid}.html` - Individual app HTML files

### Key IPC Events

- `generation-progress` - Real-time updates during generation
- `generation-complete` - Success with app metadata
- `generation-error` - Failure message

## Key Files

- `/src/hooks/useApps.ts` - Main state management and event handling
- `/src-tauri/src/commands/agent.rs` - Generation orchestration and sidecar communication
- `/src-tauri/src/commands/apps.rs` - App CRUD operations
- `/src-tauri/src/models/app.rs` - AppMetadata and AppsIndex data structures
- `/sidecar/src/index.ts` - Claude Agent SDK integration and HTML generation
