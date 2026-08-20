import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { EngineClient } from './engineClient';

export interface FileHistoryCommit {
  hash: string;
  shortHash: string;
  authorName: string;
  timestamp: number;
  subject: string;
  parents?: string[];
}

export class FileHistoryProvider implements vscode.TreeDataProvider<FileHistoryItem>, vscode.Disposable {
  private _onDidChangeTreeData: vscode.EventEmitter<FileHistoryItem | undefined | null | void> =
    new vscode.EventEmitter<FileHistoryItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<FileHistoryItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private engineClient: EngineClient;
  private currentFilePath: string | null = null;
  private limit: number = 50;
  private disposables: vscode.Disposable[] = [];

  constructor(engineClient: EngineClient) {
    this.engineClient = engineClient;

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && editor.document.uri.scheme === 'file') {
          this.setFile(editor.document.uri.fsPath);
        }
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (
          this.currentFilePath &&
          document.uri.scheme === 'file' &&
          document.uri.fsPath === this.currentFilePath
        ) {
          this.refresh();
        }
      }),
      vscode.commands.registerCommand('penguingit.fileHistory.loadMore', () => {
        this.loadMore();
      })
    );

    if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.scheme === 'file') {
      this.setFile(vscode.window.activeTextEditor.document.uri.fsPath);
    }
  }

  public setFile(filePath: string): void {
    if (!filePath || !fs.existsSync(filePath)) {
      return;
    }

    if (this.currentFilePath !== filePath) {
      this.currentFilePath = filePath;
      this.limit = 50;
    }
    this.refresh();
  }

  public loadMore(): void {
    this.limit += 50;
    this.refresh();
  }

  public refresh(element?: FileHistoryItem): void {
    this._onDidChangeTreeData.fire(element);
  }

  public getTreeItem(element: FileHistoryItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: FileHistoryItem): Promise<FileHistoryItem[]> {
    if (element) return [];

    if (!this.currentFilePath) {
      return [
        new FileHistoryItem({
          label: 'No active file selected',
          description: 'Open a file to view history',
          tooltip: 'Select an active file in the editor to view its commit history.',
          id: 'empty-no-file',
          type: 'info',
        }),
      ];
    }

    if (!fs.existsSync(this.currentFilePath)) {
      return [
        new FileHistoryItem({
          label: 'File does not exist',
          id: 'empty-file-not-found',
          type: 'info',
        }),
      ];
    }

    const repoPath = this.findRepoPath(this.currentFilePath);
    if (!repoPath) return [];

    const relativePath = path.relative(repoPath, this.currentFilePath);

    try {
      const commits: FileHistoryCommit[] = await this.engineClient.callTool('git_file_history', {
        repo_path: repoPath,
        file_path: relativePath,
        limit: this.limit,
      });

      if (!Array.isArray(commits) || commits.length === 0) {
        return [
          new FileHistoryItem({
            label: 'No commit history found for file',
            id: 'empty-no-commits',
            type: 'info',
          }),
        ];
      }

      const items: FileHistoryItem[] = commits.map((c) => {
        const fullSubject = c.subject || '';
        const subjectLine = fullSubject.split(/\r?\n/)[0];

        const fullHash = c.hash || '';
        const shortHash = c.shortHash || (fullHash ? fullHash.substring(0, 7) : '');

        const isMerge = (c.parents && c.parents.length > 1) || /^(merge|Merge)\b/i.test(subjectLine);

        return new FileHistoryItem({
          label: subjectLine,
          hash: fullHash,
          shortHash: shortHash,
          author: c.authorName || 'Unknown',
          timestamp: c.timestamp,
          fullSubject: fullSubject,
          isMerge: isMerge,
          filePath: this.currentFilePath!,
          type: 'commit',
        });
      });

      if (commits.length >= this.limit) {
        const loadMoreItem = new FileHistoryItem({
          label: 'Load More...',
          description: `Showing ${commits.length} commits`,
          tooltip: 'Click to load 50 more commits',
          id: 'load-more-item',
          type: 'loadMore',
        });
        loadMoreItem.command = {
          command: 'penguingit.fileHistory.loadMore',
          title: 'Load More Commits',
        };
        items.push(loadMoreItem);
      }

      return items;
    } catch (err: any) {
      return [
        new FileHistoryItem({
          label: `Error: ${err.message || String(err)}`,
          id: 'error-item',
          type: 'info',
        }),
      ];
    }
  }

  public findRepoPath(filePath: string): string | null {
    let currentDir = path.dirname(filePath);

    while (currentDir) {
      const gitPath = path.join(currentDir, '.git');
      if (fs.existsSync(gitPath)) {
        return currentDir;
      }
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break;
      }
      currentDir = parentDir;
    }

    const folders = vscode.workspace.workspaceFolders;
    if (folders) {
      for (const f of folders) {
        if (filePath.startsWith(f.uri.fsPath)) {
          return f.uri.fsPath;
        }
      }
    }

    return path.dirname(filePath);
  }

  public dispose(): void {
    this._onDidChangeTreeData.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}

export interface FileHistoryItemOptions {
  label: string;
  hash?: string;
  shortHash?: string;
  author?: string;
  timestamp?: number;
  fullSubject?: string;
  description?: string;
  tooltip?: string | vscode.MarkdownString;
  id?: string;
  isMerge?: boolean;
  filePath?: string;
  type?: 'commit' | 'info' | 'loadMore';
}

export class FileHistoryItem extends vscode.TreeItem {
  public readonly hash: string;
  public readonly shortHash: string;
  public readonly author: string;
  public readonly timestamp: number;

  constructor(options: FileHistoryItemOptions);
  constructor(
    label: string,
    hash: string,
    author: string,
    timestamp: number,
    collapsibleState: vscode.TreeItemCollapsibleState
  );
  constructor(
    labelOrOptions: string | FileHistoryItemOptions,
    hash?: string,
    author?: string,
    timestamp?: number,
    collapsibleState?: vscode.TreeItemCollapsibleState
  ) {
    if (typeof labelOrOptions === 'string') {
      super(labelOrOptions, collapsibleState ?? vscode.TreeItemCollapsibleState.None);
      this.hash = hash || '';
      this.shortHash = this.hash.length > 7 ? this.hash.substring(0, 7) : this.hash;
      this.author = author || '';
      this.timestamp = timestamp || 0;

      if (this.hash) {
        this.id = this.hash;
        this.description = `${this.shortHash} • ${this.author}`;
        this.iconPath = new vscode.ThemeIcon('git-commit');
        this.tooltip = this.formatTooltip(labelOrOptions, this.author, this.timestamp, this.hash);
      }
      return;
    }

    const opts = labelOrOptions;
    super(opts.label, vscode.TreeItemCollapsibleState.None);

    this.hash = opts.hash || '';
    this.shortHash = opts.shortHash || (this.hash.length > 7 ? this.hash.substring(0, 7) : this.hash);
    this.author = opts.author || '';
    this.timestamp = opts.timestamp || 0;

    if (opts.id) {
      this.id = opts.id;
    } else if (this.hash) {
      this.id = this.hash;
    }

    if (opts.type === 'commit' || (opts.hash && opts.type !== 'info' && opts.type !== 'loadMore')) {
      this.description = `${this.shortHash} • ${this.author}`;

      const iconName = opts.isMerge ? 'git-merge' : 'git-commit';
      this.iconPath = new vscode.ThemeIcon(iconName);

      const fullSubj = opts.fullSubject || opts.label;
      this.tooltip = this.formatTooltip(fullSubj, this.author, this.timestamp, this.hash);

      if (opts.filePath && this.hash) {
        const leftUri = vscode.Uri.file(opts.filePath).with({
          scheme: 'git',
          query: JSON.stringify({ path: opts.filePath, ref: `${this.hash}~1` }),
        });
        const rightUri = vscode.Uri.file(opts.filePath).with({
          scheme: 'git',
          query: JSON.stringify({ path: opts.filePath, ref: this.hash }),
        });
        const fileName = path.basename(opts.filePath);
        this.command = {
          command: 'vscode.diff',
          title: 'Open Diff',
          arguments: [leftUri, rightUri, `${fileName} (${this.shortHash})`],
        };
      }
    } else {
      if (opts.description) this.description = opts.description;
      if (opts.tooltip) this.tooltip = opts.tooltip;
      if (opts.type === 'loadMore') {
        this.iconPath = new vscode.ThemeIcon('refresh');
      } else {
        this.iconPath = new vscode.ThemeIcon('info');
      }
    }
  }

  private formatTooltip(
    fullSubject: string,
    author: string,
    timestamp: number,
    fullHash: string
  ): vscode.MarkdownString {
    const relativeTime = this.formatRelativeTime(timestamp);
    const exactDate = timestamp ? new Date(timestamp * 1000).toLocaleString() : 'Unknown';

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**${fullSubject}**\n\n`);
    md.appendMarkdown(`**Commit**: \`${fullHash}\`\n\n`);
    md.appendMarkdown(`**Author**: ${author}\n\n`);
    md.appendMarkdown(`**Date**: ${relativeTime} (${exactDate})`);
    return md;
  }

  private formatRelativeTime(timestampSec: number): string {
    if (!timestampSec) return 'unknown';
    const nowSec = Math.floor(Date.now() / 1000);
    const diffSec = nowSec - timestampSec;

    if (diffSec < 0) return 'just now';
    if (diffSec < 60) return 'just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 2592000) return `${Math.floor(diffSec / 86400)}d ago`;
    if (diffSec < 31536000) return `${Math.floor(diffSec / 2592000)}mo ago`;
    return `${Math.floor(diffSec / 31536000)}y ago`;
  }
}

