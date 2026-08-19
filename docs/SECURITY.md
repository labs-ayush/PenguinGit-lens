# Security Policy

## Supported Versions

Only the latest commit on `main` and the latest tagged release are supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1.0 | :x:                |

## Reporting a Vulnerability

Please **do not** open public GitHub issues for security vulnerabilities.

Instead, report vulnerabilities privately using [GitHub's Private Vulnerability Reporting](https://github.com/Ayush442842q/PenguinGit-lens/security/advisories/new) or contact the maintainer directly.

Please include:
- Affected version or commit SHA.
- Detailed reproduction steps.
- Potential impact assessment (e.g., local privilege escalation, socket hijacking, arbitrary command execution, path traversal).

## Security Considerations Specific to PenguinGit Lens

1. **Local IPC Socket Security**:
   - The Unix domain socket (`/tmp/penguingit-mcp.sock`) uses strict OS permissions.
   - TCP connections are restricted to `127.0.0.1` loopback only.
2. **Deep Link & URI Validation**:
   - All `penguingit://` deep links handling parameters (repository path, commit hash, file path) undergo strict sanitization and path validation before invocation.
3. **Secret Storage**:
   - Any tokens or confidential configurations are stored strictly using VS Code's `ExtensionContext.secrets` API (OS Keychain backed). Plaintext file storage is prohibited.
