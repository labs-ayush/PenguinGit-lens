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

interface LaneCommit {
  commit: CommitItem;
  lane: number;
  lanesBefore: (string | null)[];
  lanesAfter: (string | null)[];
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

    webviewView.webview.onDidReceiveMessage(async (message) => {
      const allowedCommands = ['refresh', 'openDesktop', 'copyHash'];
      if (!message || typeof message.command !== 'string' || !allowedCommands.includes(message.command)) {
        return;
      }

      if (message.command === 'refresh') {
        await this.refresh();
      } else if (message.command === 'openDesktop') {
        vscode.commands.executeCommand('penguingit.openDesktop', message.hash);
      } else if (message.command === 'copyHash') {
        if (message.hash) {
          await vscode.env.clipboard.writeText(message.hash);
          vscode.window.showInformationMessage(`Copied commit hash ${message.hash.substring(0, 7)} to clipboard.`);
        }
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; text-align: center; background: var(--vscode-editor-background); }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; margin-top: 12px; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .spinner {
      display: inline-block;
      width: 10px;
      height: 10px;
      border: 2px solid var(--vscode-button-foreground);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 4px;
      vertical-align: middle;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <p>${this.escapeHtml(message)}</p>
  <button id="refresh-btn" onclick="onRefreshClick()">🔄 Refresh Graph</button>
  <script>
    const vscode = acquireVsCodeApi();
    function onRefreshClick() {
      const btn = document.getElementById('refresh-btn');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Refreshing...';
      }
      vscode.postMessage({command: 'refresh'});
    }
  </script>
</body>
</html>`;
  }

  private calculateTopology(commits: CommitItem[]): LaneCommit[] {
    const activeLanes: (string | null)[] = [];
    const result: LaneCommit[] = [];

    for (const commit of commits) {
      const lanesBefore = [...activeLanes];

      let lane = activeLanes.indexOf(commit.hash);
      if (lane === -1) {
        const emptyIdx = activeLanes.indexOf(null);
        if (emptyIdx !== -1) {
          lane = emptyIdx;
        } else {
          lane = activeLanes.length;
        }
      }

      for (let l = 0; l < activeLanes.length; l++) {
        if (activeLanes[l] === commit.hash) {
          activeLanes[l] = null;
        }
      }

      const primaryParent = commit.parents && commit.parents.length > 0 ? commit.parents[0] : null;
      activeLanes[lane] = primaryParent;

      if (commit.parents && commit.parents.length > 1) {
        for (let p = 1; p < commit.parents.length; p++) {
          const parentHash = commit.parents[p];
          if (!activeLanes.includes(parentHash)) {
            const emptyIdx = activeLanes.indexOf(null);
            if (emptyIdx !== -1) {
              activeLanes[emptyIdx] = parentHash;
            } else {
              activeLanes.push(parentHash);
            }
          }
        }
      }

      while (activeLanes.length > 0 && activeLanes[activeLanes.length - 1] === null) {
        activeLanes.pop();
      }

      const lanesAfter = [...activeLanes];

      result.push({
        commit,
        lane,
        lanesBefore,
        lanesAfter,
      });
    }

    return result;
  }

  private renderGraphHtml(commits: CommitItem[]): string {
    const topology = this.calculateTopology(commits);
    let maxLanes = 1;
    for (const item of topology) {
      maxLanes = Math.max(maxLanes, item.lanesBefore.length, item.lanesAfter.length, item.lane + 1);
    }

    const svgWidth = maxLanes * 16 + 8;
    const laneColors = [
      'var(--vscode-symbolIcon-colorForeground, #38bdf8)',
      'var(--vscode-textLink-foreground, #4ade80)',
      'var(--vscode-symbolIcon-keywordForeground, #fb923c)',
      'var(--vscode-symbolIcon-classForeground, #c084fc)',
      'var(--vscode-charts-yellow, #facc15)',
    ];

    const rows = topology
      .map((item) => {
        const c = item.commit;
        const shortHash = c.shortHash || (c.hash ? c.hash.substring(0, 7) : '');
        const isHead = c.refs && c.refs.some((r) => r.includes('HEAD'));

        const refsBadges = (c.refs || [])
          .map((ref) => {
            const isHeadRef = ref.includes('HEAD');
            return `<span class="badge ${isHeadRef ? 'badge-head' : ''}">${this.escapeHtml(ref)}</span>`;
          })
          .join(' ');

        const relativeDate = c.timestamp ? this.formatRelativeTime(c.timestamp) : '';
        const isoDate = c.timestamp ? new Date(c.timestamp * 1000).toISOString() : '';

        // Generate SVG elements for DAG lane indicators
        const svgLines: string[] = [];
        const xNode = item.lane * 16 + 10;
        const yNode = 16;
        const nodeColor = laneColors[item.lane % laneColors.length];

        // Draw top incoming lines
        for (let l = 0; l < item.lanesBefore.length; l++) {
          const hashBefore = item.lanesBefore[l];
          if (hashBefore !== null) {
            const xTop = l * 16 + 10;
            const color = laneColors[l % laneColors.length];
            if (hashBefore === c.hash) {
              svgLines.push(`<line x1="${xTop}" y1="0" x2="${xNode}" y2="${yNode}" stroke="${color}" stroke-width="2" />`);
            } else if (item.lanesAfter[l] === hashBefore) {
              svgLines.push(`<line x1="${xTop}" y1="0" x2="${xTop}" y2="32" stroke="${color}" stroke-width="2" />`);
            } else {
              const targetIdx = item.lanesAfter.indexOf(hashBefore);
              const xBot = targetIdx !== -1 ? targetIdx * 16 + 10 : xTop;
              svgLines.push(`<line x1="${xTop}" y1="0" x2="${xBot}" y2="32" stroke="${color}" stroke-width="2" />`);
            }
          }
        }

        // Draw bottom outgoing lines
        if (c.parents && c.parents.length > 0) {
          const p0 = c.parents[0];
          const targetLane0 = item.lanesAfter.indexOf(p0);
          if (targetLane0 !== -1) {
            const xBot0 = targetLane0 * 16 + 10;
            svgLines.push(`<line x1="${xNode}" y1="${yNode}" x2="${xBot0}" y2="32" stroke="${nodeColor}" stroke-width="2" />`);
          }
          for (let p = 1; p < c.parents.length; p++) {
            const pHash = c.parents[p];
            const targetLaneP = item.lanesAfter.indexOf(pHash);
            if (targetLaneP !== -1) {
              const xBotP = targetLaneP * 16 + 10;
              const mergeColor = laneColors[targetLaneP % laneColors.length];
              svgLines.push(`<line x1="${xNode}" y1="${yNode}" x2="${xBotP}" y2="32" stroke="${mergeColor}" stroke-width="2" stroke-dasharray="3,2" />`);
            }
          }
        }

        // Draw node circle
        svgLines.push(
          `<circle cx="${xNode}" cy="${yNode}" r="4" fill="${nodeColor}" stroke="var(--vscode-editor-background)" stroke-width="1.5" />`
        );

        const svgMarkup = `<div class="lane-container" style="width:${svgWidth}px;"><svg class="lane-svg" width="${svgWidth}" height="32">${svgLines.join('')}</svg></div>`;
        const ariaLabel = `Commit ${shortHash}: ${this.escapeHtml(c.subject)} by ${this.escapeHtml(c.authorName)}`;

        return `<div class="commit-row ${isHead ? 'is-head' : ''}" tabindex="0" role="listitem" aria-label="${ariaLabel}" data-hash="${c.hash}">
          ${svgMarkup}
          <div class="commit-body">
            <div class="commit-header">
              <span class="hash">${shortHash}</span>
              ${refsBadges}
              <span class="subject">${this.escapeHtml(c.subject)}</span>
            </div>
            <div class="commit-meta">
              <span class="author">${this.escapeHtml(c.authorName)}</span> • <span class="date" title="${isoDate}">${relativeDate}</span>
            </div>
          </div>
          <div class="commit-actions">
            <button class="action-btn" title="Copy Commit Hash" onclick="copyHash(event, '${c.hash}')">📋</button>
            <button class="action-btn" title="Open in Desktop" onclick="openDesktop(event, '${c.hash}')">🖥️</button>
          </div>
        </div>`;
      })
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 8px; margin: 0; background: var(--vscode-editor-background); }
    .toolbar { display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-bottom: 1px solid var(--vscode-widget-border); font-size: 11px; }
    .toolbar button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 3px 8px; border-radius: 3px; cursor: pointer; display: flex; align-items: center; }
    .toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground)); }
    .spinner {
      display: inline-block;
      width: 10px;
      height: 10px;
      border: 2px solid var(--vscode-button-secondaryForeground);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 4px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .graph-list { display: flex; flex-direction: column; }
    .commit-row { display: flex; align-items: center; padding: 6px 8px; border-bottom: 1px solid var(--vscode-editor-lineHighlightBorder, var(--vscode-widget-border)); position: relative; cursor: pointer; user-select: none; }
    .commit-row:hover { background: var(--vscode-list-hoverBackground); }
    .commit-row:focus, .commit-row:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: -2px; background: var(--vscode-list-focusBackground); }
    .commit-row.is-head { background: var(--vscode-editor-lineHighlightBackground, rgba(255, 255, 255, 0.04)); border-left: 3px solid var(--vscode-focusBorder); }
    .lane-container { flex-shrink: 0; margin-right: 8px; display: flex; align-items: center; }
    .lane-svg { display: block; }
    .commit-body { flex: 1; min-width: 0; }
    .commit-header { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .hash { font-family: var(--vscode-editor-font-family); font-size: 11px; color: var(--vscode-textLink-foreground); font-weight: bold; }
    .badge { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 10px; padding: 1px 5px; border-radius: 3px; }
    .badge-head { border: 1px solid var(--vscode-focusBorder); font-weight: bold; }
    .subject { font-size: 12px; font-weight: 500; color: var(--vscode-editor-foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
    .commit-meta { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
    .commit-actions { display: none; gap: 4px; margin-left: 8px; }
    .commit-row:hover .commit-actions, .commit-row:focus .commit-actions, .commit-row:focus-within .commit-actions { display: flex; }
    .action-btn { background: transparent; color: var(--vscode-icon-foreground, var(--vscode-foreground)); border: none; padding: 2px 4px; border-radius: 3px; cursor: pointer; font-size: 12px; }
    .action-btn:hover { background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.1)); }

    /* Custom Context Menu */
    #context-menu {
      display: none;
      position: fixed;
      z-index: 1000;
      background: var(--vscode-menu-background, var(--vscode-editor-background));
      color: var(--vscode-menu-foreground, var(--vscode-foreground));
      border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border));
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      border-radius: 4px;
      padding: 4px 0;
      min-width: 140px;
    }
    #context-menu .menu-item {
      padding: 6px 12px;
      font-size: 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #context-menu .menu-item:hover {
      background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
      color: var(--vscode-menu-selectionForeground, var(--vscode-foreground));
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <span><strong>🐧 PenguinGit Commit Graph</strong> (${commits.length} commits)</span>
    <button id="refresh-btn" onclick="onRefreshClick()">🔄 Refresh</button>
  </div>
  <div class="graph-list" role="list">
    ${rows}
  </div>

  <div id="context-menu">
    <div class="menu-item" onclick="onMenuAction('copyHash')">📋 Copy Commit Hash</div>
    <div class="menu-item" onclick="onMenuAction('openDesktop')">🖥️ Open in Desktop</div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let selectedHash = null;

    function onRefreshClick() {
      const btn = document.getElementById('refresh-btn');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Refreshing...';
      }
      vscode.postMessage({ command: 'refresh' });
    }

    function copyHash(e, hash) {
      if (e) e.stopPropagation();
      hideContextMenu();
      vscode.postMessage({ command: 'copyHash', hash: hash });
    }

    function openDesktop(e, hash) {
      if (e) e.stopPropagation();
      hideContextMenu();
      vscode.postMessage({ command: 'openDesktop', hash: hash });
    }

    const contextMenu = document.getElementById('context-menu');

    function hideContextMenu() {
      if (contextMenu) contextMenu.style.display = 'none';
    }

    function onMenuAction(action) {
      if (!selectedHash) return;
      if (action === 'copyHash') {
        copyHash(null, selectedHash);
      } else if (action === 'openDesktop') {
        openDesktop(null, selectedHash);
      }
    }

    document.addEventListener('click', hideContextMenu);

    document.querySelectorAll('.commit-row').forEach(row => {
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const hash = row.getAttribute('data-hash');
          if (hash) {
            openDesktop(e, hash);
          }
        }
      });

      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        selectedHash = row.getAttribute('data-hash');
        if (contextMenu) {
          contextMenu.style.display = 'block';
          contextMenu.style.left = e.clientX + 'px';
          contextMenu.style.top = e.clientY + 'px';
        }
      });
    });
  </script>
</body>
</html>`;
  }

  private formatRelativeTime(timestampSec: number): string {
    if (!timestampSec) return '';
    const now = Math.floor(Date.now() / 1000);
    const diff = Math.max(0, now - timestampSec);
    if (diff < 30) return 'just now';
    if (diff < 60) return `${diff} seconds ago`;
    const minutes = Math.floor(diff / 60);
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} day${days > 1 ? 's' : ''} ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months > 1 ? 's' : ''} ago`;
    const years = Math.floor(months / 12);
    return `${years} year${years > 1 ? 's' : ''} ago`;
  }

  private escapeHtml(str: string): string {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\n/g, '&#10;')
      .replace(/\t/g, '&#9;');
  }
}

