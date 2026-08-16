import * as vscode from 'vscode';
import * as path from 'path';
import { EngineClient } from './engineClient';

export interface BlameLine {
  hash: string;
  authorName: string;
  timestamp: number;
  lineNumber: number;
  content: string;
  summary: string;
}

export class BlameDecorator implements vscode.Disposable {
  private engineClient: EngineClient;
  private decorationType: vscode.TextEditorDecorationType;
  private blameCache: Map<string, { lines: BlameLine[]; mtime: number }> = new Map();
  private disposables: vscode.Disposable[] = [];
  private currentEditor: vscode.TextEditor | undefined;

  constructor(engineClient: EngineClient) {
    this.engineClient = engineClient;

    this.decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        margin: '0 0 0 3em',
        color: new vscode.ThemeColor('editorCodeLens.foreground'),
        fontStyle: 'italic',
      },
      isWholeLine: false,
    });

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.currentEditor = editor;
        this.updateBlame();
      }),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.textEditor === this.currentEditor) {
          this.updateBlame();
        }
      })
    );

    this.engineClient.on('repo-changed', () => {
      this.blameCache.clear();
      this.updateBlame();
    });

    this.currentEditor = vscode.window.activeTextEditor;
    this.updateBlame();
  }

  public async updateBlame(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.isUntitled) {
      this.clearDecorations();
      return;
    }

    const config = vscode.workspace.getConfiguration('penguingit');
    const enabled = config.get<boolean>('enableInlineBlame', true);
    if (!enabled) {
      this.clearDecorations();
      return;
    }

    const docUri = editor.document.uri;
    if (docUri.scheme !== 'file') {
      this.clearDecorations();
      return;
    }

    const filePath = docUri.fsPath;
    const repoPath = this.findRepoPath(filePath);
    if (!repoPath) {
      this.clearDecorations();
      return;
    }

    const relativeFilePath = path.relative(repoPath, filePath);
    const line = editor.selection.active.line + 1; // 1-indexed

    try {
      const blameLines = await this.getBlameData(repoPath, relativeFilePath);
      const matchingLine = blameLines.find((b) => b.lineNumber === line);

      if (!matchingLine) {
        this.clearDecorations();
        return;
      }

      const isUncommitted = matchingLine.hash.split('').every((c) => c === '0');
      let text = '';

      if (isUncommitted) {
        text = 'Uncommitted changes';
      } else {
        const formatStr = config.get<string>('ghostTextFormat', '${author}, ${age} • ${summary}');
        const age = this.formatRelativeTime(matchingLine.timestamp);
        text = formatStr
          .replace('${author}', matchingLine.authorName)
          .replace('${age}', age)
          .replace('${summary}', matchingLine.summary)
          .replace('${hash}', matchingLine.hash.substring(0, 7));
      }

      const decorationRange = new vscode.Range(
        editor.selection.active.line,
        editor.document.lineAt(editor.selection.active.line).range.end.character,
        editor.selection.active.line,
        editor.document.lineAt(editor.selection.active.line).range.end.character
      );

      const decoration: vscode.DecorationOptions = {
        range: decorationRange,
        renderOptions: {
          after: {
            contentText: ` ${text}`,
          },
        },
      };

      editor.setDecorations(this.decorationType, [decoration]);
    } catch (err) {
      this.clearDecorations();
    }
  }

  private async getBlameData(repoPath: string, relativePath: string): Promise<BlameLine[]> {
    const cacheKey = `${repoPath}:${relativePath}`;
    const cached = this.blameCache.get(cacheKey);

    if (cached && Date.now() - cached.mtime < 10000) {
      return cached.lines;
    }

    const result = await this.engineClient.callTool('git_blame', {
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
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return path.dirname(filePath);

    for (const folder of workspaceFolders) {
      if (filePath.startsWith(folder.uri.fsPath)) {
        return folder.uri.fsPath;
      }
    }
    return path.dirname(filePath);
  }

  private clearDecorations(): void {
    if (vscode.window.activeTextEditor) {
      vscode.window.activeTextEditor.setDecorations(this.decorationType, []);
    }
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

  public dispose(): void {
    this.decorationType.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
