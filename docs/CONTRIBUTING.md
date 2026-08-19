# Contributing to PenguinGit Lens

Thanks for your interest in contributing to **PenguinGit Lens**! The project is in active development — please check the [ROADMAP.md](ROADMAP.md) and open issues/PRs before starting work to avoid duplicating in-progress efforts.

## Ground Rules

1. **Shared Engine IPC model (hard rule).** PenguinGit Lens does not re-implement Git plumbing or spawn raw `git` subprocesses directly inside the extension host thread. All Git commands, status queries, diffs, and blame annotations MUST go through the typed `EngineClient` IPC connection (`/tmp/penguingit-mcp.sock` or TCP port `34284`).
2. **Typed JSON-RPC / MCP protocols.** All messages sent to or received from the PenguinGit Engine must be fully typed in TypeScript under `src/engineClient.ts` or dedicated service modules.
3. **No plaintext credentials.** Any secrets or tokens MUST go through official VS Code secret storage (`extensionContext.secrets`), never `localStorage` or plaintext config files.
4. **Zero runtime network fetches for assets.** Webview assets, fonts, icons, and bundles MUST be local and static. The extension must function identically with network access disabled.
5. **One PR per feature or bug fix.** Keep PRs scoped to a single feature, bug fix, or roadmap phase. Cross-cutting refactors should be discussed first in an issue.

## Development Setup

1. **Prerequisites**: Node.js >= 18, `pnpm` >= 9.x, and VS Code >= 1.90.0.
2. **Install dependencies**:
   ```bash
   pnpm install
   ```
3. **Build TypeScript code**:
   ```bash
   pnpm build
   ```
4. **Watch mode during development**:
   ```bash
   pnpm watch
   ```
5. **Launch Extension Host**: Press `F5` in VS Code to launch a new Extension Development Host window for live debugging.

## Testing & Verification

- **Run tests**:
  ```bash
  pnpm test
  ```
- **Package VSIX**:
  ```bash
  pnpm package
  ```

## Commit Messages

Write commit messages that explain _why_ a change was made, not just _what_ changed — the diff already shows what changed. Reference roadmap phases or issues where applicable (e.g., `Phase 1: fix socket connection retry delay`).

## Reporting Bugs & Requesting Features

Use the issue templates under [`.github/ISSUE_TEMPLATE/`](../.github/ISSUE_TEMPLATE/). For security vulnerabilities, see [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Code of Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before participating.
