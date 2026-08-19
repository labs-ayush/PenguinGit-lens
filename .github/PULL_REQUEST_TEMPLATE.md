## What does this PR do?

<!-- Concise description of the change and why it's needed. -->

## Roadmap phase / issue

<!-- Which ROADMAP.md phase does this belong to, or which issue does it close? -->
Closes #

## Checklist

- [ ] All Git operations communicate via `EngineClient` IPC to the PenguinGit daemon (no direct `git` process spawning in extension host)
- [ ] No secrets/tokens committed or logged in plaintext
- [ ] `pnpm build` passes without TypeScript errors
- [ ] `pnpm test` passes
- [ ] `pnpm package` successfully generates a valid `.vsix` bundle
- [ ] Manually verified in VS Code Extension Host (describe how below)

## How was this tested?

<!-- Describe manual verification steps in Extension Development Host -->

## Screenshots (if UI change)
