import * as net from 'net';
import { EventEmitter } from 'events';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  method?: string;
  params?: any;
}

export interface EngineClientOptions {
  socketPath?: string;
  tcpPort?: number;
  useTcp?: boolean;
  autoReconnect?: boolean;
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

export class EngineClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private isConnected: boolean = false;
  private pendingRequests: Map<string | number, { resolve: (val: any) => void; reject: (err: Error) => void }> = new Map();
  private requestCounter = 0;
  private buffer = '';
  private options: EngineClientOptions;
  private isManualDisconnect: boolean = false;
  private isReconnecting: boolean = false;
  private reconnectAttempt: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(options: EngineClientOptions = {}) {
    super();
    // Prevent unhandled EventEmitter 'error' crash if caller hasn't attached listener
    this.on('error', () => {});
    this.options = {
      socketPath: options.socketPath || '/tmp/penguingit-mcp.sock',
      tcpPort: options.tcpPort || 34284,
      useTcp: options.useTcp ?? process.platform === 'win32',
      autoReconnect: options.autoReconnect ?? true,
      maxRetries: options.maxRetries ?? 10,
      initialDelayMs: options.initialDelayMs ?? 1000,
      maxDelayMs: options.maxDelayMs ?? 30000,
    };
  }

  public connect(): Promise<boolean> {
    this.isManualDisconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    return new Promise((resolve) => {
      if (this.socket) {
        this.socket.destroy();
        this.socket = null;
      }

      const connectionOpts: net.NetConnectOpts = this.options.useTcp
        ? { host: '127.0.0.1', port: this.options.tcpPort ?? 34284 }
        : { path: this.options.socketPath ?? '/tmp/penguingit-mcp.sock' };

      this.socket = net.createConnection(connectionOpts, () => {
        // Send MCP initialize request
        const initReq = {
          jsonrpc: '2.0',
          id: 'init',
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'penguingit-lens',
              version: '0.1.0',
            },
          },
        };

        this.pendingRequests.set('init', {
          resolve: () => {
            // Send MCP initialized notification
            const initializedNotification = {
              jsonrpc: '2.0',
              method: 'notifications/initialized',
            };
            try {
              this.socket?.write(JSON.stringify(initializedNotification) + '\n');
              this.isConnected = true;
              this.emit('connected');
              resolve(true);
            } catch (err) {
              resolve(false);
            }
          },
          reject: () => {
            resolve(false);
          },
        });

        try {
          this.socket!.write(JSON.stringify(initReq) + '\n');
        } catch (err) {
          this.pendingRequests.delete('init');
          resolve(false);
        }
      });

      this.socket.on('data', (chunk: Buffer) => {
        this.handleData(chunk.toString('utf-8'));
      });

      this.socket.on('error', (err: Error) => {
        this.handleError(err);
        resolve(false);
      });

      this.socket.on('close', () => {
        const wasConnected = this.isConnected;
        this.isConnected = false;
        this.socket = null;
        if (wasConnected) {
          this.emit('disconnected');
          if (!this.isManualDisconnect && this.options.autoReconnect) {
            this.scheduleReconnect();
          }
        } else {
          const initRequest = this.pendingRequests.get('init');
          if (initRequest) {
            this.pendingRequests.delete('init');
            initRequest.reject(new Error('Connection closed during initialization'));
          }
          resolve(false);
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.isManualDisconnect || !this.options.autoReconnect) {
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.options.maxRetries !== undefined && this.reconnectAttempt >= this.options.maxRetries) {
      this.isReconnecting = false;
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempt++;

    const initial = this.options.initialDelayMs ?? 1000;
    const max = this.options.maxDelayMs ?? 30000;
    const delayMs = Math.min(initial * Math.pow(2, this.reconnectAttempt - 1), max);

    this.emit('reconnecting', { attempt: this.reconnectAttempt, delayMs });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.isManualDisconnect) return;

      const success = await this.connect();
      if (success) {
        this.reconnectAttempt = 0;
        this.isReconnecting = false;
        this.emit('reconnected');
      } else {
        if (!this.isManualDisconnect && this.options.autoReconnect) {
          this.scheduleReconnect();
        }
      }
    }, delayMs);
  }

  public disconnect(): void {
    this.isManualDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isReconnecting = false;
    this.reconnectAttempt = 0;

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    const wasConnected = this.isConnected;
    this.isConnected = false;
    if (wasConnected) {
      this.emit('disconnected');
    }
  }

  public updateOptions(options: Partial<EngineClientOptions>): void {
    this.options = { ...this.options, ...options };
  }

  public async reconnect(): Promise<boolean> {
    this.emit('reconnecting');
    this.disconnect();
    return this.connect();
  }

  public dispose(): void {
    this.disconnect();
  }

  public checkConnection(): boolean {
    return this.isConnected;
  }

  public getIsReconnecting(): boolean {
    return this.isReconnecting;
  }

  private handleData(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg: JsonRpcResponse = JSON.parse(line.trim());
        this.processMessage(msg);
      } catch (err) {
        console.error('[PenguinGit EngineClient] Failed to parse JSON message:', line, err);
      }
    }
  }

  private processMessage(msg: JsonRpcResponse): void {
    // Check for push notifications (e.g. repo-changed)
    if (msg.method === 'notifications/event' && msg.params) {
      if (msg.params.event === 'repo-changed') {
        this.emit('repo-changed', msg.params.repo_path);
      }
      return;
    }

    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const { resolve, reject } = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);

      if (msg.error) {
        reject(new Error(msg.error.message || 'JSON-RPC Error'));
      } else {
        resolve(msg.result);
      }
    }
  }

  private handleError(err: Error): void {
    for (const [, { reject }] of this.pendingRequests) {
      reject(err);
    }
    this.pendingRequests.clear();
    this.emit('error', err);
  }

  public sendRequest(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected || !this.socket) {
        return reject(new Error('PenguinGit Engine is not connected'));
      }

      const id = ++this.requestCounter;
      const req: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, { resolve, reject });

      try {
        this.socket.write(JSON.stringify(req) + '\n');
      } catch (err: any) {
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  public async callTool(name: string, args: Record<string, any>): Promise<any> {
    const result = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    });

    if (result && result.content && Array.isArray(result.content)) {
      const textItem = result.content.find((c: any) => c.type === 'text');
      if (textItem && textItem.text) {
        try {
          return JSON.parse(textItem.text);
        } catch {
          return textItem.text;
        }
      }
    }
    return result;
  }

  public async ping(): Promise<boolean> {
    try {
      if (!this.isConnected) {
        const ok = await this.connect();
        if (!ok) return false;
      }
      // Issue a lightweight status request to confirm engine response
      await this.callTool('git_status', { repo_path: '.' });
      return true;
    } catch {
      return false;
    }
  }
}
