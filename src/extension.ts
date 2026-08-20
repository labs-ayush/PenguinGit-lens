import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { EngineClient } from './engineClient';
import { StatusBarManager } from './statusBar';
import { BlameDecorator } from './blameDecorator';
import { CommitHoverProvider } from './hoverProvider';
import { CommitGraphWebviewProvider } from './graphWebviewProvider';
import { FileHistoryProvider } from './fileHistoryProvider';

let engineClient: EngineClient | null = null;
let statusBarManager: StatusBarManager | null = null;
let blameDecorator: BlameDecorator | null = null;
let fileHistoryProvider: FileHistoryProvider | null = null;

function hasGitRepository(): boolean {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return false;
  }
  return folders.some((folder) => {
    const gitPath = path.join(folder.uri.fsPath, '.git');
    return fs.existsSync(gitPath);
  });
}

export async function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('penguingit');
  const socketPath = config.get<string>('socketPath', '/tmp/penguingit-mcp.sock');
  const tcpPort = config.get<number>('tcpPort', 34284);
  const useTcp = config.get<boolean>('useTcp', process.platform === 'win32');

  engineClient = new EngineClient({ socketPath, tcpPort, useTcp });
  statusBarManager = new StatusBarManager(engineClient);
  blameDecorator = new BlameDecorator(engineClient);
  fileHistoryProvider = new FileHistoryProvider(engineClient);

  context.subscriptions.push(statusBarManager, blameDecorator, fileHistoryProvider);

  // Reconnect EngineClient on configuration change
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (
        e.affectsConfiguration('penguingit.socketPath') ||
        e.affectsConfiguration('penguingit.tcpPort') ||
        e.affectsConfiguration('penguingit.useTcp')
      ) {
        const updatedConfig = vscode.workspace.getConfiguration('penguingit');
        const newSocketPath = updatedConfig.get<string>('socketPath', '/tmp/penguingit-mcp.sock');
        const newTcpPort = updatedConfig.get<number>('tcpPort', 34284);
        const newUseTcp = updatedConfig.get<boolean>('useTcp', process.platform === 'win32');

        if (engineClient) {
          engineClient.updateOptions({
            socketPath: newSocketPath,
            tcpPort: newTcpPort,
            useTcp: newUseTcp,
          });
          await engineClient.reconnect();
        }
      }
    })
  );

  // Register Hover Provider
  context.subscriptions.push(
    vscode.languages.registerHoverProvider('*', new CommitHoverProvider(engineClient))
  );

  // Register Commit Graph Webview Provider
  const graphProvider = new CommitGraphWebviewProvider(engineClient);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CommitGraphWebviewProvider.viewType, graphProvider)
  );

  // Register File History Tree View
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('penguingit-lens.fileHistory', fileHistoryProvider)
  );

  // Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('penguingit.showMenu', () => {
      statusBarManager?.showMenu();
    }),

    vscode.commands.registerCommand('penguingit.checkStatus', async () => {
      if (!engineClient) return;
      const isConnected = await engineClient.ping();
      if (isConnected) {
        vscode.window.showInformationMessage('PenguinGit Engine is connected and active.');
      } else {
        const choice = await vscode.window.showWarningMessage(
          'PenguinGit Engine is offline.',
          'Start Engine',
          'Open Desktop App'
        );
        if (!choice) return;
        if (choice === 'Start Engine') {
          vscode.commands.executeCommand('penguingit.startEngine');
        } else if (choice === 'Open Desktop App') {
          vscode.commands.executeCommand('penguingit.openDesktop');
        }
      }
    }),

    vscode.commands.registerCommand('penguingit.startEngine', async () => {
      try {
        const child = spawn('penguingit-mcp', ['--socket', socketPath], {
          detached: true,
          stdio: ['ignore', 'ignore', 'pipe'],
        });

        let stderrData = '';
        if (child.stderr) {
          child.stderr.on('data', (chunk) => {
            stderrData += chunk.toString();
          });
        }

        child.on('error', (err) => {
          vscode.window.showErrorMessage(`Failed to start Engine daemon: ${err.message}`);
        });

        child.on('exit', (code) => {
          if (code !== null && code !== 0) {
            const errMsg = stderrData.trim() || `Process exited with code ${code}`;
            vscode.window.showErrorMessage(`PenguinGit Engine daemon failed to start: ${errMsg}`);
          }
        });

        child.unref();

        vscode.window.showInformationMessage('Spawning PenguinGit Engine daemon...');

        setTimeout(async () => {
          if (engineClient) {
            const ok = await engineClient.connect();
            if (ok) {
              vscode.window.showInformationMessage('Connected to PenguinGit Engine!');
            }
          }
        }, 500);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to start Engine daemon: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('penguingit.openDesktop', async () => {
      try {
        const opened = await vscode.env.openExternal(vscode.Uri.parse('penguingit://open'));
        if (!opened) {
          vscode.window.showErrorMessage(
            'Could not launch PenguinGit Desktop App. Please make sure PenguinGit Desktop is installed from https://penguingit.com'
          );
        }
      } catch {
        vscode.window.showErrorMessage(
          'Could not launch PenguinGit Desktop App. Please make sure PenguinGit Desktop is installed from https://penguingit.com'
        );
      }
    }),

    vscode.commands.registerCommand('penguingit.interactiveRebase', async (uri?: vscode.Uri) => {
      try {
        const folder = uri?.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        if (!folder) {
          vscode.window.showWarningMessage('No repository or workspace folder found.');
          return;
        }
        const opened = await vscode.env.openExternal(
          vscode.Uri.parse(`penguingit://rebase?repo=${encodeURIComponent(folder)}`)
        );
        if (!opened) {
          vscode.window.showErrorMessage(
            'Could not launch Interactive Rebase in PenguinGit Desktop App. Please make sure PenguinGit Desktop is installed from https://penguingit.com'
          );
        }
      } catch {
        vscode.window.showErrorMessage('Could not launch Interactive Rebase in PenguinGit Desktop App.');
      }
    }),

    vscode.commands.registerCommand('penguingit.resolveConflicts', async (uri?: vscode.Uri) => {
      try {
        const folder = uri?.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        if (!folder) {
          vscode.window.showWarningMessage('No repository or workspace folder found.');
          return;
        }
        const opened = await vscode.env.openExternal(
          vscode.Uri.parse(`penguingit://conflicts?repo=${encodeURIComponent(folder)}`)
        );
        if (!opened) {
          vscode.window.showErrorMessage(
            'Could not launch Conflict Resolution in PenguinGit Desktop App. Please make sure PenguinGit Desktop is installed from https://penguingit.com'
          );
        }
      } catch {
        vscode.window.showErrorMessage('Could not launch Conflict Resolution in PenguinGit Desktop App.');
      }
    }),

    vscode.commands.registerCommand('penguingit.viewFileHistory', (uri?: vscode.Uri) => {
      const targetUri = uri || vscode.window.activeTextEditor?.document.uri;
      if (targetUri && targetUri.scheme === 'file') {
        fileHistoryProvider?.setFile(targetUri.fsPath);
        vscode.commands.executeCommand('penguingit-lens.fileHistory.focus');
      } else {
        vscode.window.showInformationMessage('Select a file to view history.');
      }
    }),

    vscode.commands.registerCommand('penguingit.toggleInlineBlame', async () => {
      const config = vscode.workspace.getConfiguration('penguingit');
      const current = config.get<boolean>('enableInlineBlame', true);
      await config.update('enableInlineBlame', !current, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        `PenguinGit Inline Blame ${!current ? 'enabled' : 'disabled'}.`
      );
      if (blameDecorator) {
        blameDecorator.updateBlame();
      }
    })
  );

  // Initial Connection Attempt
  if (hasGitRepository()) {
    const connected = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Connecting to PenguinGit Engine...',
        cancellable: false,
      },
      async () => {
        return await engineClient!.connect();
      }
    );

    if (!connected) {
      const choice = await vscode.window.showWarningMessage(
        "PenguinGit Engine isn't running. Start the engine for inline blame and graph views.",
        'Start Engine',
        'Learn More'
      );
      if (choice === 'Start Engine') {
        vscode.commands.executeCommand('penguingit.startEngine');
      }
    }
  }
}

export function deactivate() {
  if (statusBarManager) {
    statusBarManager.dispose();
    statusBarManager = null;
  }
  if (blameDecorator) {
    blameDecorator.dispose();
    blameDecorator = null;
  }
  if (fileHistoryProvider) {
    fileHistoryProvider = null;
  }
  if (engineClient) {
    engineClient.dispose();
    engineClient = null;
  }
}
