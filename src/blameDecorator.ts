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
  private selectionDebounceTimer: NodeJS.Timeout | undefined;

  constructor(engineClient: EngineClient) {
    this.engineClient = engineClient;

    this.decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        margin: '0 0 0 2em',
        color: new vscode.ThemeColor('editorCodeLens.foreground'),
        fontStyle: 'italic',
      },
      isWholeLine: false,
    });

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (this.currentEditor && this.currentEditor !== editor) {
          this.clearDecorations(this.currentEditor);
        }
        this.currentEditor = editor;
        this.updateBlame();
      }),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.textEditor === this.currentEditor) {
          // #98: Avoid updating blame during active IME composition or selection change driven by text edit/typing
          if (!e.kind) {
            this.clearDecorations(this.currentEditor);
            return;
          }

          // #32: Debounce onDidChangeTextEditorSelection listener (150ms debounce delay)
          if (this.selectionDebounceTimer) {
            clearTimeout(this.selectionDebounceTimer);
          }
          this.selectionDebounceTimer = setTimeout(() => {
            this.updateBlame();
          }, 150);
        }
      }),
      // #36: Listen to vscode.workspace.onDidCloseTextDocument and clear decorations if closed doc was being decorated
      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (this.currentEditor && this.currentEditor.document === doc) {
          this.clearDecorations(this.currentEditor);
          this.currentEditor = undefined;
        }
      }),
      // Clear decorations on text document edits to prevent stale ghost text during typing
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.currentEditor && e.document === this.currentEditor.document) {
          this.clearDecorations(this.currentEditor);
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
      this.clearDecorations(this.currentEditor);
      return;
    }

    // #31: Clear ghost text when switching to a diff editor, git scheme, or non-file scheme
    const docUri = editor.document.uri;
    if (docUri.scheme !== 'file') {
      this.clearDecorations(editor);
      return;
    }

    const config = vscode.workspace.getConfiguration('penguingit');
    const enabled = config.get<boolean>('enableInlineBlame', true);
    if (!enabled) {
      this.clearDecorations(editor);
      return;
    }

    // #34: Skip git_blame IPC calls on binary files
    if (this.isBinaryFile(editor.document)) {
      this.clearDecorations(editor);
      return;
    }

    const filePath = docUri.fsPath;
    const repoPath = this.findRepoPath(filePath);
    if (!repoPath) {
      this.clearDecorations(editor);
      return;
    }

    const relativeFilePath = path.relative(repoPath, filePath);
    const line = editor.selection.active.line + 1; // 1-indexed

    // #39: Record editor.document.version before async getBlameData call
    const documentVersion = editor.document.version;

    try {
      const blameLines = await this.getBlameData(repoPath, relativeFilePath);

      // #39: Verify document version and active editor match before applying decorations
      if (vscode.window.activeTextEditor !== editor || editor.document.version !== documentVersion) {
        return;
      }

      const matchingLine = blameLines.find((b) => b.lineNumber === line);

      if (!matchingLine) {
        this.clearDecorations(editor);
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

      // #38 & #92: Read optional penguingit.inlineBlameColor from configuration; fallback to editorCodeLens.foreground
      const customColor = config.get<string>('inlineBlameColor')?.trim();
      let inlineColor: string | vscode.ThemeColor = new vscode.ThemeColor('editorCodeLens.foreground');
      if (customColor) {
        if (customColor.startsWith('#') || customColor.startsWith('rgb') || customColor.startsWith('hsl')) {
          inlineColor = customColor;
        } else {
          inlineColor = new vscode.ThemeColor(customColor);
        }
      }

      const decoration: vscode.DecorationOptions = {
        range: decorationRange,
        renderOptions: {
          after: {
            contentText: ` ${text}`,
            color: inlineColor,
          },
        },
      };

      editor.setDecorations(this.decorationType, [decoration]);
    } catch (err) {
      this.clearDecorations(editor);
    }
  }

  // #37: Make cacheKey case-insensitive on Windows
  private getCacheKey(repoPath: string, relativePath: string): string {
    const key = `${repoPath}:${relativePath}`;
    return process.platform === 'win32' ? key.toLowerCase() : key;
  }

  private async getBlameData(repoPath: string, relativePath: string): Promise<BlameLine[]> {
    const cacheKey = this.getCacheKey(repoPath, relativePath);
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

  // #34: Check if document is binary
  private isBinaryFile(doc: vscode.TextDocument): boolean {
    if (doc.languageId === 'binary') {
      return true;
    }
    const binaryExtensions = new Set([
      '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.tiff', '.pdf',
      '.zip', '.tar', '.gz', '.7z', '.rar', '.exe', '.dll', '.so', '.dylib',
      '.bin', '.dat', '.db', '.sqlite', '.woff', '.woff2', '.ttf', '.eot', '.otf',
      '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.pyc', '.class', '.o', '.a', '.obj',
    ]);
    const ext = path.extname(doc.fileName || doc.uri.fsPath).toLowerCase();
    return binaryExtensions.has(ext);
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

  private clearDecorations(editor?: vscode.TextEditor): void {
    const target = editor || vscode.window.activeTextEditor || this.currentEditor;
    if (target) {
      target.setDecorations(this.decorationType, []);
    }
  }

  // #35: Guard formatRelativeTime against 0, invalid, or NaN timestamps (return 'unknown')
  private formatRelativeTime(timestampSec: number): string {
    if (
      typeof timestampSec !== 'number' ||
      Number.isNaN(timestampSec) ||
      timestampSec <= 0 ||
      !Number.isFinite(timestampSec)
    ) {
      return 'unknown';
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const diffSec = nowSec - timestampSec;
    if (diffSec < 0) return 'unknown';

    if (diffSec < 60) return 'just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 2592000) return `${Math.floor(diffSec / 86400)}d ago`;
    if (diffSec < 31536000) return `${Math.floor(diffSec / 2592000)}mo ago`;
    return `${Math.floor(diffSec / 31536000)}y ago`;
  }

  public dispose(): void {
    if (this.selectionDebounceTimer) {
      clearTimeout(this.selectionDebounceTimer);
      this.selectionDebounceTimer = undefined;
    }
    this.decorationType.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
