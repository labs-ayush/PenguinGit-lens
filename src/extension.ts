import * as vscode from 'vscode';
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
          stdio: 'ignore',
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
        await vscode.env.openExternal(vscode.Uri.parse('penguingit://open'));
      } catch {
        vscode.window.showErrorMessage('Could not launch PenguinGit Desktop App.');
      }
    }),

    vscode.commands.registerCommand('penguingit.interactiveRebase', async () => {
      try {
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        await vscode.env.openExternal(vscode.Uri.parse(`penguingit://rebase?repo=${encodeURIComponent(folder)}`));
      } catch {
        vscode.window.showErrorMessage('Could not launch Interactive Rebase in PenguinGit Desktop App.');
      }
    }),

    vscode.commands.registerCommand('penguingit.resolveConflicts', async () => {
      try {
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        await vscode.env.openExternal(vscode.Uri.parse(`penguingit://conflicts?repo=${encodeURIComponent(folder)}`));
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
    })
  );

  // Initial Connection Attempt
  const connected = await engineClient.connect();
  if (!connected) {
    vscode.window.showWarningMessage(
      'PenguinGit Engine isn\'t running. Start the engine for inline blame and graph views.',
      'Start Engine',
      'Learn More'
    ).then((choice) => {
      if (choice === 'Start Engine') {
        vscode.commands.executeCommand('penguingit.startEngine');
      }
    });
  }
}

export function deactivate() {
  if (engineClient) {
    engineClient.disconnect();
    engineClient = null;
  }
}
