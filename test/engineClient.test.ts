import { EngineClient } from '../src/engineClient';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

async function runTest() {
  console.log('Testing EngineClient against penguingit-mcp background daemon...');
  const testSocketPath = '/tmp/penguingit-mcp-test.sock';

  let dir = __dirname;
  let engineBinPath = '';
  while (dir !== path.parse(dir).root) {
    const candidates = [
      path.join(dir, 'target/debug/penguingit-mcp'),
      path.join(dir, '../PenguinGit/target/debug/penguingit-mcp'),
      '/home/ayush/Programs/PenguinGit/target/debug/penguingit-mcp',
    ];

    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        engineBinPath = cand;
        break;
      }
    }
    if (engineBinPath) break;
    dir = path.dirname(dir);
  }

  if (!engineBinPath) {
    throw new Error('Could not find target/debug/penguingit-mcp binary. Build Rust workspace first.');
  }
  if (fs.existsSync(testSocketPath)) {
    try {
      fs.unlinkSync(testSocketPath);
    } catch {}
  }

  console.log(`Spawning daemon binary at: ${engineBinPath} --socket ${testSocketPath}`);

  const daemon: ChildProcess = spawn(engineBinPath, ['--socket', testSocketPath], {
    stdio: 'inherit',
  });

  const client = new EngineClient({ socketPath: testSocketPath });

  try {
    let connected = false;
    for (let i = 0; i < 15; i++) {
      connected = await client.connect();
      if (connected) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!connected) {
      throw new Error('Failed to connect to test daemon socket after retries');
    }
    console.log('✅ Connected to daemon socket successfully');

    const statusResult = await client.callTool('git_status', { repo_path: '.' });
    console.log('✅ git_status tool call response received');

    const blameResult = await client.callTool('git_blame', {
      repo_path: '.',
      file_path: 'package.json',
    });
    console.log('✅ git_blame tool call response received:', Array.isArray(blameResult) ? `${blameResult.length} lines blamed` : blameResult);

    client.disconnect();
    daemon.kill('SIGTERM');
    console.log('✅ Disconnected cleanly. EngineClient integration test PASSED!');
    process.exit(0);
  } catch (err: any) {
    console.error('❌ Test failed:', err.message);
    client.disconnect();
    daemon.kill('SIGTERM');
    process.exit(1);
  }
}

runTest();
