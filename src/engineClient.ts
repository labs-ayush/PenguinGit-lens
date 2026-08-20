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
  connectTimeout?: number;
  requestTimeout?: number;
  maxBufferSize?: number;
  autoReconnect?: boolean;
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

export class EngineClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private isConnected: boolean = false;
  private pendingRequests: Map<
    string | number,
    { resolve: (val: any) => void; reject: (err: Error) => void; timeoutId?: NodeJS.Timeout }
  > = new Map();
  private requestCounter = 0;
  private buffer = '';
  private options: EngineClientOptions;
  private isManualDisconnect: boolean = false;
  private isReconnecting: boolean = false;
  private reconnectAttempt: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(options: EngineClientOptions = {}) {
    super();
    // Prevent unhandled EventEmitter 'error' and 'permissionDenied' crash if caller hasn't attached listener
    this.on('error', () => {});
    this.on('permissionDenied', () => {});
    const rawSocketPath = options.socketPath || '/tmp/penguingit-mcp.sock';
    this.options = {
      socketPath: typeof rawSocketPath === 'string' ? rawSocketPath.trim() : rawSocketPath,
      tcpPort: options.tcpPort || 34284,
      useTcp: options.useTcp ?? process.platform === 'win32',
      connectTimeout: options.connectTimeout ?? 5000,
      requestTimeout: options.requestTimeout ?? 15000,
      maxBufferSize: options.maxBufferSize ?? 64 * 1024 * 1024,
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

      let isResolved = false;
      let connectTimeoutTimer: NodeJS.Timeout | null = null;

      const done = (result: boolean) => {
        if (isResolved) return;
        isResolved = true;
        if (connectTimeoutTimer) {
          clearTimeout(connectTimeoutTimer);
          connectTimeoutTimer = null;
        }
        resolve(result);
      };

      const timeoutMs = this.options.connectTimeout ?? 5000;
      connectTimeoutTimer = setTimeout(() => {
        if (this.socket) {
          this.socket.destroy();
          this.socket = null;
        }
        if (this.pendingRequests.has('init')) {
          const item = this.pendingRequests.get('init')!;
          if (item.timeoutId) clearTimeout(item.timeoutId);
          this.pendingRequests.delete('init');
          item.reject(new Error('Connection timeout during initialize'));
        }
        done(false);
      }, timeoutMs);

      const tryConnect = (hostOrOpts: net.NetConnectOpts, isFallback: boolean = false) => {
        this.socket = net.createConnection(hostOrOpts, () => {
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
                done(true);
              } catch (err) {
                done(false);
              }
            },
            reject: () => {
              done(false);
            },
          });

          try {
            this.socket!.write(JSON.stringify(initReq) + '\n');
          } catch (err) {
            const item = this.pendingRequests.get('init');
            if (item?.timeoutId) clearTimeout(item.timeoutId);
            this.pendingRequests.delete('init');
            done(false);
          }
        });

        this.socket.on('data', (chunk: Buffer) => {
          this.handleData(chunk.toString('utf-8'));
        });

        this.socket.on('error', (err: Error) => {
          if (
            this.options.useTcp &&
            !isFallback &&
            (err as any)?.code === 'ECONNREFUSED'
          ) {
            if (this.socket) {
              this.socket.removeAllListeners();
              this.socket.destroy();
              this.socket = null;
            }
            tryConnect({ host: '::1', port: this.options.tcpPort ?? 34284 }, true);
            return;
          }

          this.handleError(err);
          done(false);
        });

        this.socket.on('close', () => {
          const wasConnected = this.isConnected;
          this.isConnected = false;
          this.socket = null;
          this.requestCounter = 0;

          // Reject every in-flight request so callers never hang indefinitely.
          const closeError = new Error(
            wasConnected
              ? 'PenguinGit IPC connection closed unexpectedly'
              : 'Connection closed during initialization'
          );
          for (const [, { reject: rejectPending, timeoutId }] of this.pendingRequests) {
            if (timeoutId) clearTimeout(timeoutId);
            rejectPending(closeError);
          }
          this.pendingRequests.clear();

          if (wasConnected) {
            this.emit('disconnected');
            if (!this.isManualDisconnect && this.options.autoReconnect) {
              this.scheduleReconnect();
            }
          } else {
            done(false);
          }
        });
      };

      const initialOpts: net.NetConnectOpts = this.options.useTcp
        ? { host: '127.0.0.1', port: this.options.tcpPort ?? 34284 }
        : { path: this.options.socketPath ?? '/tmp/penguingit-mcp.sock' };

      tryConnect(initialOpts, false);
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
    this.requestCounter = 0;
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
    const maxBufferSize = this.options.maxBufferSize ?? 64 * 1024 * 1024;
    if (this.buffer.length + data.length > maxBufferSize) {
      this.buffer = '';
      const err = new Error(`Buffer size limit exceeded (max ${maxBufferSize} bytes)`);
      this.handleError(err);
      if (this.socket) {
        this.socket.destroy();
        this.socket = null;
      }
      return;
    }

    this.buffer += data;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg: JsonRpcResponse = JSON.parse(trimmed);
        this.processMessage(msg);
      } catch (err) {
        console.error('[PenguinGit EngineClient] Failed to parse JSON message:', line, err);
      }
    }
  }

  private resolvePendingRequestId(id: string | number | undefined): string | number | undefined {
    if (id === undefined || id === null) return undefined;
    if (this.pendingRequests.has(id)) return id;

    if (typeof id === 'string') {
      const numId = Number(id);
      if (!isNaN(numId) && this.pendingRequests.has(numId)) {
        return numId;
      }
    } else if (typeof id === 'number') {
      const strId = String(id);
      if (this.pendingRequests.has(strId)) {
        return strId;
      }
    }
    return undefined;
  }

  private processMessage(msg: JsonRpcResponse): void {
    // Handle push notifications
    if (msg.method) {
      this.emit('notification', msg.method, msg.params);

      if (msg.method === 'notifications/event' && msg.params) {
        if (msg.params.event === 'repo-changed') {
          this.emit('repo-changed', msg.params.repo_path);
        }
      }

      if (msg.id === undefined) {
        return;
      }
    }

    const reqId = this.resolvePendingRequestId(msg.id);
    if (reqId !== undefined) {
      const { resolve, reject, timeoutId } = this.pendingRequests.get(reqId)!;
      if (timeoutId) clearTimeout(timeoutId);
      this.pendingRequests.delete(reqId);

      if (msg.error) {
        reject(new Error(msg.error.message || 'JSON-RPC Error'));
      } else {
        resolve(msg.result);
      }
    }
  }

  private handleError(err: Error): void {
    if ((err as any)?.code === 'EACCES') {
      this.emit('permissionDenied', err);
    }
    for (const [, { reject, timeoutId }] of this.pendingRequests) {
      if (timeoutId) clearTimeout(timeoutId);
      reject(err);
    }
    this.pendingRequests.clear();
    this.emit('error', err);
  }

  public sendRequest(method: string, params?: any, timeoutMs?: number): Promise<any> {
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

      const timeout = timeoutMs ?? this.options.requestTimeout ?? 15000;
      let timeoutId: NodeJS.Timeout | undefined;
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          const item = this.pendingRequests.get(id);
          if (item) {
            this.pendingRequests.delete(id);
            reject(new Error(`Request '${method}' (id: ${id}) timed out after ${timeout}ms`));
          }
        }, timeout);
      }

      this.pendingRequests.set(id, { resolve, reject, timeoutId });

      try {
        this.socket.write(JSON.stringify(req) + '\n');
      } catch (err: any) {
        if (timeoutId) clearTimeout(timeoutId);
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  public async callTool(name: string, args: Record<string, any>): Promise<any> {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('callTool: tool name must be a non-empty string');
    }
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      throw new TypeError('callTool: arguments must be a non-null object');
    }

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
        if (!ok) {
          console.error('[PenguinGit EngineClient] Ping failed: IPC connection could not be established');
          return false;
        }
      }
      // Issue a lightweight status request to confirm engine response
      await this.callTool('git_status', { repo_path: '.' });
      return true;
    } catch (err) {
      console.error('[PenguinGit EngineClient] Ping failed:', err);
      return false;
    }
  }
}
