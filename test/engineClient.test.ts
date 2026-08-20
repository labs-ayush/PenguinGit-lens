import * as net from 'net';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { EngineClient } from '../src/engineClient';

/**
 * Creates a temporary Unix socket server that accepts one connection,
 * then immediately destroys it to simulate an unexpected daemon crash.
 */
function createCrashingServer(socketPath: string): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((conn) => {
      // Simulate daemon crash — destroy socket without sending anything back.
      setImmediate(() => conn.destroy());
    });
    server.listen(socketPath, () => resolve(server));
    server.on('error', reject);
  });
}

/**
 * Creates a Unix socket server that:
 *  1. Completes the MCP handshake so the client reaches `isConnected = true`.
 *  2. Accepts the next RPC call, waits briefly, then destroys the connection
 *     to simulate a daemon crash while a request is in-flight.
 */
function createHandshakeThenCrashServer(socketPath: string): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((conn) => {
      let buffer = '';
      let handshakeDone = false;

      conn.on('data', (chunk) => {
        buffer += chunk.toString('utf-8');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line.trim());

            if (!handshakeDone && msg.method === 'initialize') {
              // Reply with initialize result to complete handshake
              const reply = JSON.stringify({
                jsonrpc: '2.0',
                id: msg.id,
                result: { protocolVersion: '2024-11-05', capabilities: {} },
              });
              conn.write(reply + '\n');
            } else if (msg.method === 'notifications/initialized') {
              handshakeDone = true;
            } else if (handshakeDone) {
              // Received a real RPC call — crash the daemon mid-flight
              setTimeout(() => conn.destroy(), 20);
            }
          } catch {
            // ignore parse errors
          }
        }
      });
    });

    server.listen(socketPath, () => resolve(server));
    server.on('error', reject);
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('EngineClient — issue #1: pending requests must reject on socket close', () => {
  const tmpDir = os.tmpdir();
  let socketPath: string;
  let server: net.Server;

  beforeEach(() => {
    socketPath = path.join(tmpDir, `penguingit-test-${process.pid}-${Date.now()}.sock`);
  });

  afterEach(async () => {
    await new Promise<void>((res) => server.close(() => res()));
    try { fs.unlinkSync(socketPath); } catch { /* already gone */ }
  });

  // ── Test 1 ────────────────────────────────────────────────────────────────
  test(
    'connect() resolves false (not hangs) when socket closes during initialization',
    async () => {
      server = await createCrashingServer(socketPath);
      const client = new EngineClient({ socketPath, useTcp: false });

      const result = await client.connect();
      expect(result).toBe(false);
    },
    3000 /* ms timeout */
  );

  // ── Test 2 ────────────────────────────────────────────────────────────────
  test(
    'in-flight sendRequest() rejects (not hangs) when daemon crashes mid-request',
    async () => {
      server = await createHandshakeThenCrashServer(socketPath);
      const client = new EngineClient({ socketPath, useTcp: false });

      const connected = await client.connect();
      expect(connected).toBe(true);

      // Fire an RPC and expect it to reject when the socket drops
      await expect(
        client.sendRequest('tools/call', { name: 'git_blame', arguments: {} })
      ).rejects.toThrow(/connection closed unexpectedly/i);
    },
    5000
  );

  // ── Test 3 ────────────────────────────────────────────────────────────────
  test(
    'multiple in-flight requests all reject (not hang) on socket close',
    async () => {
      server = await createHandshakeThenCrashServer(socketPath);
      const client = new EngineClient({ socketPath, useTcp: false });

      await client.connect();

      // Fire several concurrent requests
      const promises = [
        client.sendRequest('tools/call', { name: 'git_blame', arguments: {} }),
        client.sendRequest('tools/call', { name: 'git_log',   arguments: {} }),
        client.sendRequest('tools/call', { name: 'git_status',arguments: {} }),
      ];

      const results = await Promise.allSettled(promises);
      for (const r of results) {
        expect(r.status).toBe('rejected');
        expect((r as PromiseRejectedResult).reason.message).toMatch(
          /connection closed unexpectedly/i
        );
      }
    },
    5000
  );
});
