# Changelog

All notable changes to **PenguinGit Lens** are documented in this file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

- Automated VS Code Marketplace deployment pipeline.

## [v0.1.0] - 2026-08-16

### Added
- **Inline Current-Line Blame**: Ghost text annotations displaying author, relative age, commit hash, and summary for the line under cursor.
- **Commit Hover Cards**: Rich Markdown popups showing author details, commit hashes, relative age, and quick actions.
- **Visual Commit Graph Webview**: Responsive DAG commit graph panel showing commit history, branches, lanes, and WIP status.
- **File History Tree View**: Context menu command (`penguingit.viewFileHistory`) to inspect complete file revision timelines across renames.
- **PenguinGit Engine IPC Client**: Lightweight JSON-RPC 2.0 socket client connecting to local `/tmp/penguingit-mcp.sock` or TCP port `34284` with automatic reconnection handling.
- **Desktop Handoff Integration**: Deep-link commands (`penguingit.interactiveRebase`, `penguingit.resolveConflicts`, `penguingit.openDesktop`) launching the native PenguinGit Desktop GUI.
- **Extension Settings**: User settings for toggling inline blame, customizing ghost text formatting, socket path, and TCP fallback.
