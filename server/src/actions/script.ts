import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ScriptAction } from '../config.js';

const INTERPRETERS: Record<ScriptAction['run'], string> = {
  bash: 'bash',
  pwsh: 'pwsh',
  // macOS and most Linux distros only ship python3; Windows ships python.
  python: process.platform === 'win32' ? 'python' : 'python3',
};

/**
 * Spawn the script and return immediately (fire-and-forget per spec).
 * Output and exit status are logged server-side.
 */
export function runScript(action: ScriptAction, configDir: string): void {
  const scriptPath = path.resolve(configDir, action.path);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`script not found: ${scriptPath}`);
  }
  const interpreter = INTERPRETERS[action.run];
  const child = spawn(interpreter, [scriptPath, ...action.args], {
    cwd: configDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tag = `[script:${action.path}]`;
  child.stdout.on('data', (chunk: Buffer) => process.stdout.write(`${tag} ${chunk}`));
  child.stderr.on('data', (chunk: Buffer) => process.stderr.write(`${tag} ${chunk}`));
  child.on('error', (err) => console.error(`${tag} failed to start ${interpreter}: ${err.message}`));
  child.on('exit', (code) => {
    if (code !== 0) console.error(`${tag} exited with code ${code}`);
  });
}
