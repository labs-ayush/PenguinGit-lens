import * as vscode from 'vscode';
import { EngineClient } from './engineClient';

export class StatusBarManager implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private engineClient: EngineClient;

  constructor(engineClient: EngineClient) {
    this.engineClient = engineClient;
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );

    this.statusBarItem.command = 'penguingit.showMenu';

    this.engineClient.on('connected', () => this.updateStatus(true));
    this.engineClient.on('disconnected', () => this.updateStatus(false));

    this.updateStatus(false);
    this.statusBarItem.show();
  }

  public updateStatus(connected: boolean): void {
    if (connected) {
      this.statusBarItem.text = '$(plug) PenguinGit: Connected';
      this.statusBarItem.tooltip = 'PenguinGit Engine is connected and active';
      this.statusBarItem.backgroundColor = undefined;
    } else {
      this.statusBarItem.text = '$(plug) PenguinGit: Offline';
      this.statusBarItem.tooltip = 'Click to start PenguinGit Engine or check connection';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground'
      );
    }
  }

  public async showMenu(): Promise<void> {
    const isConnected = this.engineClient.checkConnection();
    const items: vscode.QuickPickItem[] = [
      {
        label: isConnected ? '$(check) Engine Connected' : '$(play) Start PenguinGit Engine',
        description: isConnected
          ? 'Engine is active and listening on socket'
          : 'Launch local daemon background process',
      },
      {
        label: '$(pulse) Check Connection Status',
        description: 'Verify connection to local daemon',
      },
      {
        label: '$(desktop-download) Open Desktop App',
        description: 'Launch full PenguinGit Desktop GUI',
      },
    ];

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'PenguinGit Lens Options',
    });

    if (!selected) return;

    if (selected.label.includes('Start PenguinGit Engine')) {
      vscode.commands.executeCommand('penguingit.startEngine');
    } else if (selected.label.includes('Check Connection Status')) {
      vscode.commands.executeCommand('penguingit.checkStatus');
    } else if (selected.label.includes('Open Desktop App')) {
      vscode.commands.executeCommand('penguingit.openDesktop');
    }
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
