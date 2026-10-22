import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const env = { ...process.env, PATH: path.join(os.homedir(), '.cargo', 'bin') + path.delimiter + process.env.PATH };
const command = process.platform === 'win32' ? 'node_modules/.bin/tauri.cmd' : 'node_modules/.bin/tauri';
const child = spawn(command, process.argv.slice(2), { stdio: 'inherit', env, shell: process.platform === 'win32' });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
