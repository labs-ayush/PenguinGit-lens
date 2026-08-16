import * as vscode from 'vscode';
import * as path from 'path';
import { EngineClient } from './engineClient';
import { BlameLine } from './blameDecorator';

export class CommitHoverProvider implements vscode.HoverProvider {
  private engineClient: EngineClient;

  constructor(engineClient: EngineClient) {
    this.engineClient = engineClient;
  }

  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | null> {
    if (document.uri.scheme !== 'file') return null;

    const config = vscode.workspace.getConfiguration('penguingit');
    if (!config.get<boolean>('enableInlineBlame', true)) return null;

    const filePath = document.uri.fsPath;
    const repoPath = this.findRepoPath(filePath);
    if (!repoPath) return null;

    const relativePath = path.relative(repoPath, filePath);
    const lineNumber = position.line + 1; // 1-indexed

    try {
      const blameLines: BlameLine[] = await this.engineClient.callTool('git_blame', {
        repo_path: repoPath,
        file_path: relativePath,
      });

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
      const ageStr = this.formatRelativeTime(matching.timestamp);

      const md = new vscode.MarkdownString();
      md.isTrusted = true;
      md.appendMarkdown(`### 🐧 PenguinGit Commit Details\n\n`);
      md.appendMarkdown(`**Commit**: \`${shortHash}\` (${matching.hash})\n\n`);
      md.appendMarkdown(`**Author**: ${matching.authorName} (${ageStr})\n\n`);
      md.appendMarkdown(`---\n\n`);
      md.appendMarkdown(`**Summary**: ${matching.summary}\n\n`);
      md.appendMarkdown(`---\n\n`);
      md.appendMarkdown(
        `[📜 View File History](command:penguingit.viewFileHistory) &nbsp;|&nbsp; [🖥️ Open Desktop App](command:penguingit.openDesktop)`
      );

      return new vscode.Hover(md);
    } catch {
      return null;
    }
  }

  private findRepoPath(filePath: string): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return path.dirname(filePath);

    for (const f of folders) {
      if (filePath.startsWith(f.uri.fsPath)) return f.uri.fsPath;
    }
    return path.dirname(filePath);
  }

  private formatRelativeTime(timestampSec: number): string {
    if (!timestampSec) return 'unknown';
    const nowSec = Math.floor(Date.now() / 1000);
    const diffSec = nowSec - timestampSec;

    if (diffSec < 60) return 'just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 2592000) return `${Math.floor(diffSec / 86400)}d ago`;
    if (diffSec < 31536000) return `${Math.floor(diffSec / 2592000)}mo ago`;
    return `${Math.floor(diffSec / 31536000)}y ago`;
  }
}
