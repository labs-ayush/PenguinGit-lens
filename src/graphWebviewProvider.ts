import * as vscode from 'vscode';
import { EngineClient } from './engineClient';

export interface CommitItem {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  timestamp: number;
  parents: string[];
  refs: string[];
  subject: string;
}

export class CommitGraphWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'penguingit-lens.commitGraph';
  private view?: vscode.WebviewView;
  private engineClient: EngineClient;

  constructor(engineClient: EngineClient) {
    this.engineClient = engineClient;

    this.engineClient.on('repo-changed', () => {
      this.refresh();
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.onDidReceiveMessage((message) => {
      if (message.command === 'refresh') {
        this.refresh();
      } else if (message.command === 'openDesktop') {
        vscode.commands.executeCommand('penguingit.openDesktop');
      }
    });

    this.refresh();
  }

  public async refresh(): Promise<void> {
    if (!this.view) return;

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      this.view.webview.html = this.renderEmptyState('No workspace folder open.');
      return;
    }

    const repoPath = folders[0].uri.fsPath;

    try {
      const commits: CommitItem[] = await this.engineClient.callTool('git_log', {
        repo_path: repoPath,
        limit: 50,
      });

      if (!Array.isArray(commits) || commits.length === 0) {
        this.view.webview.html = this.renderEmptyState('No commit history found in workspace repo.');
        return;
      }

      this.view.webview.html = this.renderGraphHtml(commits);
    } catch (err: any) {
      this.view.webview.html = this.renderEmptyState(`Failed to load commit graph: ${err.message}`);
    }
  }

  private renderEmptyState(message: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; text-align: center; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; margin-top: 12px; }
  </style>
</head>
<body>
  <p>${message}</p>
  <button onclick="vscode.postMessage({command: 'refresh'})">Refresh Graph</button>
  <script>const vscode = acquireVsCodeApi();</script>
</body>
</html>`;
  }

  private renderGraphHtml(commits: CommitItem[]): string {
    const rows = commits
      .map((c) => {
        const shortHash = c.shortHash || c.hash.substring(0, 7);
        const refsBadge =
          c.refs && c.refs.length > 0
            ? `<span class="badge">${c.refs.join(', ')}</span>`
            : '';
        const dateStr = c.timestamp ? new Date(c.timestamp * 1000).toLocaleDateString() : '';

        return `<div class="commit-row">
          <div class="lane-node"></div>
          <div class="commit-body">
            <div class="commit-header">
              <span class="hash">${shortHash}</span>
              ${refsBadge}
              <span class="subject">${this.escapeHtml(c.subject)}</span>
            </div>
            <div class="commit-meta">
              <span class="author">${this.escapeHtml(c.authorName)}</span> • <span class="date">${dateStr}</span>
            </div>
          </div>
        </div>`;
      })
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 8px; margin: 0; background: var(--vscode-editor-background); }
    .toolbar { display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-bottom: 1px solid var(--vscode-widget-border); font-size: 11px; }
    .toolbar button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 3px 8px; border-radius: 3px; cursor: pointer; }
    .commit-row { display: flex; align-items: flex-start; padding: 6px 8px; border-bottom: 1px solid var(--vscode-editor-lineHighlightBorder); }
    .commit-row:hover { background: var(--vscode-list-hoverBackground); }
    .lane-node { width: 10px; height: 10px; border-radius: 50%; background: #38bdf8; margin-top: 4px; margin-right: 10px; flex-shrink: 0; }
    .commit-body { flex: 1; min-width: 0; }
    .commit-header { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .hash { font-family: var(--vscode-editor-font-family); font-size: 11px; color: #a78bfa; font-weight: bold; }
    .badge { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 10px; padding: 1px 5px; border-radius: 3px; }
    .subject { font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
    .commit-meta { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
  </style>
</head>
<body>
  <div class="toolbar">
    <span><strong>🐧 PenguinGit Commit Graph</strong> (${commits.length} commits)</span>
    <button onclick="vscode.postMessage({command: 'refresh'})">🔄 Refresh</button>
  </div>
  <div class="graph-list">
    ${rows}
  </div>
  <script>const vscode = acquireVsCodeApi();</script>
</body>
</html>`;
  }

  private escapeHtml(str: string): string {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
