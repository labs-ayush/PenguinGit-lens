# Architecture of PenguinGit Lens

This document explains the technical design and architectural boundaries of **PenguinGit Lens**, a lightweight, high-performance VS Code extension companion to the **PenguinGit** ecosystem.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 VS Code Extension Host                       │
│                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────┐  │
│  │ Inline Blame     │  │ Commit Hover     │  │ Commit    │  │
│  │ Decorator        │  │ Provider         │  │ Graph     │  │
│  └────────┬─────────┘  └────────┬─────────┘  └─────┬─────┘  │
│           │                     │                  │        │
│           └─────────────────────┼──────────────────┘        │
│                                 ▼                           │
│                      EngineClient (IPC)                     │
└─────────────────────────────────┬───────────────────────────┘
                                  │
                       Unix Domain Socket / TCP
                                  │
┌─────────────────────────────────▼───────────────────────────┐
│              PenguinGit Engine Daemon (Rust / MCP)          │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  System Git Process Runner & File System Watcher       │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────┬───────────────────────────┘
                                  │
                          Target Git Repository
```

## Shared Engine Model

Unlike standalone VS Code extensions that spawn redundant `git` subprocesses or bundle heavy node-based git parsers, **PenguinGit Lens** relies on a daemonized, shared engine architecture:

1. **PenguinGit Engine Daemon**: Rust-powered core server (`penguingit-mcp`) handling system git subprocess execution, caching, lane layout computation, and filesystem watching.
2. **IPC Transport**: Unix Domain Socket (`/tmp/penguingit-mcp.sock`) on Linux/macOS or TCP (`127.0.0.1:34284`) on Windows and fallback environments.
3. **Thin VS Code Extension**: TypeScript-based extension host UI layer focused purely on editor integrations, text decorations, hover cards, webview panels, and tree views.

## Component Breakdown

- **EngineClient (`src/engineClient.ts`)**: Manages the socket/TCP connection lifecycle, automated reconnects with exponential backoff, JSON-RPC 2.0 payload serialization, and event subscription.
- **Inline Blame (`src/blameDecorator.ts`)**: Listens to active text editor selection events and renders current-line blame ghost text annotations.
- **Hover Provider (`src/hoverProvider.ts`)**: Generates Markdown-formatted hover popups containing author details, commit hashes, relative age, and action buttons.
- **Commit Graph Webview (`src/webview/commitGraph.ts`)**: Responsive webview panel rendering the visual DAG commit graph with branch lanes and commit metadata.
- **File History (`src/fileHistoryTree.ts`)**: Tree view panel tracking file revision history across renames.
- **Desktop Handoff (`src/desktopBridge.ts`)**: Launches the native PenguinGit Desktop GUI app via `penguingit://` deep links for advanced operations like 3-Way Merge Conflict Resolution and Interactive Rebase.

## Key Design Principles

1. **Zero-Lag Editor Performance**: Heavy operations (DAG lane layout calculation, file diff parsing) occur inside the background Rust daemon, keeping the VS Code UI thread smooth.
2. **Offline-First & Privacy-Focused**: No telemetry or external server dependencies. All communication is strictly local machine IPC.
3. **Resilient Reconnection**: If the PenguinGit Engine restarts or starts after VS Code, the extension automatically reconnects without requiring editor reload.
