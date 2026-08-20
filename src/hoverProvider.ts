import * as vscode from 'vscode';
import * as path from 'path';
import { EngineClient } from './engineClient';
import { BlameLine, formatRelativeTime, escapeMarkdown } from './utils';

export class CommitHoverProvider implements vscode.HoverProvider {
  private engineClient: EngineClient;
  private blameCache: Map<string, { lines: BlameLine[]; mtime: number }> = new Map();
  private readonly CACHE_TTL_MS = 10000; // 10s TTL

  constructor(engineClient: EngineClient) {
    this.engineClient = engineClient;

    this.engineClient.on('repo-changed', () => {
      this.blameCache.clear();
    });
  }

  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | null> {
    // Guard against virtual documents, output channels, and untitled documents (#66)
    if (document.uri.scheme !== 'file' || document.isUntitled) return null;

    const config = vscode.workspace.getConfiguration('penguingit');
    if (!config.get<boolean>('enableInlineBlame', true)) return null;

    const filePath = document.uri.fsPath;
    const repoPath = this.findRepoPath(filePath);
    if (!repoPath) return null;

    const relativePath = path.relative(repoPath, filePath);

    // Clamp line position safely to valid document range to prevent EOF failures (#68)
    if (document.lineCount === 0) return null;
    const clampedLine = Math.max(0, Math.min(position.line, document.lineCount - 1));
    const lineNumber = clampedLine + 1; // 1-indexed

    try {
      const blameLines = await this.getBlameData(repoPath, relativePath);
      if (!Array.isArray(blameLines)) return null;

      const matching = blameLines.find((b) => b.lineNumber === lineNumber);
      if (!matching) return null;

      const isUncommitted = matching.hash.split('').every((c) => c === '0');
      if (isUncommitted) {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**Uncommitted Changes**\n\nLine ${lineNumber} has not been committed yet.`);
        return new vscode.Hover(md);
      }

      const shortHash = matching.hash.substring(0, 7);
      const ageStr = formatRelativeTime(matching.timestamp);

      // Collect branch ref badges when available (#67)
      const refBadges: string[] = [];
      if (typeof matching.branch === 'string' && matching.branch) {
        refBadges.push(matching.branch);
      }
      if (Array.isArray(matching.branches)) {
        for (const b of matching.branches) {
          if (typeof b === 'string' && b && !refBadges.includes(b)) {
            refBadges.push(b);
          }
        }
      }
      if (Array.isArray(matching.refs)) {
        for (const r of matching.refs) {
          if (typeof r === 'string' && r && !refBadges.includes(r)) {
            refBadges.push(r);
          }
        }
      } else if (typeof matching.refs === 'string' && matching.refs && !refBadges.includes(matching.refs)) {
        refBadges.push(matching.refs);
      }
      if (typeof matching.ref === 'string' && matching.ref && !refBadges.includes(matching.ref)) {
        refBadges.push(matching.ref);
      }

      const badgeStr = refBadges.length > 0
        ? ' &nbsp; ' + refBadges.map((b) => `\`$(git-branch) ${escapeMarkdown(b)}\``).join(' ')
        : '';

      // Format author display with email if available (#63)
      const authorDisplay = matching.authorEmail
        ? `${escapeMarkdown(matching.authorName)} &lt;${escapeMarkdown(matching.authorEmail)}&gt;`
        : escapeMarkdown(matching.authorName);

      // Sanitize special Markdown characters in commit summary (#69)
      const sanitizedSummary = escapeMarkdown(matching.summary || '');

      // Create encoded URIs for command links (#62, #65)
      const encodedDocUri = encodeURIComponent(JSON.stringify([document.uri]));
      const leftUri = document.uri.with({ query: `ref=${matching.hash}~1` });
      const rightUri = document.uri.with({ query: `ref=${matching.hash}` });
      const diffTitle = `${path.basename(filePath)} (${shortHash})`;
      const encodedDiffArgs = encodeURIComponent(JSON.stringify([leftUri, rightUri, diffTitle]));

      const md = new vscode.MarkdownString();
      md.isTrusted = true;
      md.supportThemeIcons = true;
      md.appendMarkdown(`### 🐧 PenguinGit Commit Details${badgeStr}\n\n`);
      md.appendMarkdown(`**Commit**: \`${shortHash}\` (\`${matching.hash}\`)\n\n`);
      md.appendMarkdown(`**Author**: ${authorDisplay} (${ageStr})\n\n`);
      md.appendMarkdown(`---\n\n`);
      md.appendMarkdown(`**Summary**: ${sanitizedSummary}\n\n`);

      // Use language specifier / codeblock formatting for commit code snippets (#61)
      if (matching.content !== undefined && matching.content !== null && matching.content.trim() !== '') {
        md.appendCodeblock(matching.content, document.languageId);
        md.appendMarkdown(`\n`);
      }

      md.appendMarkdown(`---\n\n`);
      md.appendMarkdown(
        `[🔍 View Diff](command:vscode.diff?${encodedDiffArgs}) &nbsp;|&nbsp; ` +
        `[📜 View File History](command:penguingit.viewFileHistory?${encodedDocUri}) &nbsp;|&nbsp; ` +
        `[🖥️ Open Desktop App](command:penguingit.openDesktop)`
      );

      return new vscode.Hover(md);
    } catch {
      return null;
    }
  }

  private async getBlameData(repoPath: string, relativePath: string): Promise<BlameLine[]> {
    const cacheKey = `${repoPath}:${relativePath}`;
    const cached = this.blameCache.get(cacheKey);

    if (cached && Date.now() - cached.mtime < this.CACHE_TTL_MS) {
      return cached.lines;
    }

    const result: BlameLine[] = await this.engineClient.callTool('git_blame', {
      repo_path: repoPath,
      file_path: relativePath,
    });

    if (Array.isArray(result)) {
      this.blameCache.set(cacheKey, { lines: result, mtime: Date.now() });
      return result;
    }
    return [];
  }

  private findRepoPath(filePath: string): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return path.dirname(filePath);

    for (const f of folders) {
      if (filePath.startsWith(f.uri.fsPath)) return f.uri.fsPath;
    }
    return path.dirname(filePath);
  }
}
