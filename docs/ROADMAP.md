# PenguinGit Lens Roadmap

PenguinGit Lens is being developed as a high-performance, open-source VS Code extension bringing inline blame, commit hover cards, commit history, and a visual DAG graph directly into VS Code — powered by the local **PenguinGit Engine**.

## Guiding Principles

1. **Shared Engine Architecture**: Connect to the background PenguinGit Engine daemon via local IPC (`/tmp/penguingit-mcp.sock` or TCP) rather than duplicating git subprocess spawning inside VS Code.
2. **Zero Overhead on Editor**: Ensure editor typing and cursor navigation remain buttery smooth with debounced decorations and daemon-derived blame data.
3. **100% Free & Open Source**: Full functionality available out of the box without paywalls or premium tiers.

## Phases

| # | Phase | Goal | Status |
|---|---|---|---|
| 0 | Extension Scaffolding & Build Pipeline | Project setup, TypeScript configuration, VS Code extension manifest, and CI integration | ✅ Done |
| 1 | Core IPC Engine Client & Inline Blame | EngineClient socket connection, auto-reconnect, and current-line blame ghost text | ✅ Done |
| 2 | Commit Hover Cards & Commit Graph Webview | Rich Markdown commit hover popups and responsive webview DAG commit graph | ✅ Done |
| 3 | File History & Desktop App Handoff | File revision tree view and `penguingit://` deep links to Desktop app for conflict resolution and interactive rebase | ✅ Done |
| 4 | CI/CD & Marketplace Packaging | Automated VSIX builds, CodeQL security scanning, and Marketplace publish preparation | ✅ Done |

## Detailed Breakdown

### Phase 0 — Scaffolding & Build Pipeline ✅
- [x] Package setup (`package.json`, `tsconfig.json`)
- [x] Compilation (`pnpm build`) and packaging script (`pnpm package`)
- [x] Test harness (`pnpm test`)

### Phase 1 — Core IPC Engine Client & Inline Blame ✅
- [x] Socket client (`src/engineClient.ts`) connecting to `/tmp/penguingit-mcp.sock` and `127.0.0.1:34284`
- [x] Blame decorator (`src/blameDecorator.ts`) rendering inline ghost text annotations
- [x] Configuration settings (`penguingit.enableInlineBlame`, `penguingit.ghostTextFormat`)

### Phase 2 — Commit Hover Cards & Commit Graph Webview ✅
- [x] Hover provider (`src/hoverProvider.ts`) with author avatar initials, hash, summary, and age
- [x] Webview container for DAG commit graph view

### Phase 3 — File History & Desktop Handoff ✅
- [x] Right-click file history context menu integration
- [x] Deep-link launcher for Desktop app interactive rebase & 3-way merge conflict editor

### Phase 4 — CI/CD & Packaging ✅
- [x] GitHub Actions CI workflow for TypeScript verification and VSIX artifact build
- [x] CodeQL and Gitleaks security scanners
- [x] VS Code Marketplace & Open VSX automated publishing pipeline (`.github/workflows/publish.yml`)
- [x] VSIX packaging configuration (`.vscodeignore`, `pnpm package`)
