import * as vscode from 'vscode';
import * as path from 'path';
import { EngineClient } from './engineClient';

export interface FileHistoryCommit {
  hash: string;
  shortHash: string;
  authorName: string;
  timestamp: number;
  subject: string;
}

export class FileHistoryProvider implements vscode.TreeDataProvider<FileHistoryItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<FileHistoryItem | undefined | null | void> =
    new vscode.EventEmitter<FileHistoryItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<FileHistoryItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private engineClient: EngineClient;
  private currentFilePath: string | null = null;

  constructor(engineClient: EngineClient) {
    this.engineClient = engineClient;

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.uri.scheme === 'file') {
        this.setFile(editor.document.uri.fsPath);
      }
    });

    if (vscode.window.activeTextEditor) {
      this.setFile(vscode.window.activeTextEditor.document.uri.fsPath);
    }
  }

  public setFile(filePath: string): void {
    this.currentFilePath = filePath;
    this.refresh();
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  public getTreeItem(element: FileHistoryItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: FileHistoryItem): Promise<FileHistoryItem[]> {
    if (element) return [];

    if (!this.currentFilePath) {
      return [new FileHistoryItem('No active file selected', '', '', 0, vscode.TreeItemCollapsibleState.None)];
    }

    const repoPath = this.findRepoPath(this.currentFilePath);
    if (!repoPath) return [];

    const relativePath = path.relative(repoPath, this.currentFilePath);

    try {
      const commits: FileHistoryCommit[] = await this.engineClient.callTool('git_file_history', {
        repo_path: repoPath,
        file_path: relativePath,
        limit: 50,
      });

      if (!Array.isArray(commits) || commits.length === 0) {
        return [new FileHistoryItem('No commit history found for file', '', '', 0, vscode.TreeItemCollapsibleState.None)];
      }

      return commits.map(
        (c) =>
          new FileHistoryItem(
            c.subject,
            c.shortHash || c.hash.substring(0, 7),
            c.authorName,
            c.timestamp,
            vscode.TreeItemCollapsibleState.None
          )
      );
    } catch (err: any) {
      return [new FileHistoryItem(`Error: ${err.message}`, '', '', 0, vscode.TreeItemCollapsibleState.None)];
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
}

export class FileHistoryItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly hash: string,
    public readonly author: string,
    public readonly timestamp: number,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);

    this.tooltip = `${this.label} (${this.hash})`;
    this.description = `${this.hash} • ${this.author}`;
    this.iconPath = new vscode.ThemeIcon('git-commit');
  }
}
