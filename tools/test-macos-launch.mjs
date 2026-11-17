// Exercise LaunchServices/Apple Events, which direct executable launches omit.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'darwin') {
  console.log('SKIP macOS LaunchServices checks require macOS');
  process.exit(0);
}
const bundle = await realpath(process.argv[2] || 'src-tauri/target/release/bundle/macos/Aropyt.app');
const work = await realpath(await mkdtemp(path.join(tmpdir(), 'aropyt-macos-launch-')));
const passed = [];
const fixtures = new Map();
for (const name of ['冷启动 # 100%.md', 'Second document.md', 'Warm open.md', 'Restored document.md']) {
  const file = path.join(work, name), content = `# ${name}\n\nLaunchServices regression fixture.\n`;
  await writeFile(file, content);
  fixtures.set(file, content);
}
const [first, second, warm, restored] = [...fixtures.keys()];
const run = (args) => new Promise((resolve, reject) => {
  const child = spawn('/usr/bin/open', args, { stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(Error(`open exited ${code}`)));
});

async function checkLaunch(name, files, preferences, check) {
  const directory = path.join(work, name), profile = path.join(directory, 'profile');
  await mkdir(path.join(profile, 'conf'), { recursive: true });
  await writeFile(path.join(profile, 'conf/conf.user.json'), JSON.stringify({
    autoSave: false, spellCheck: false, ...preferences,
  }));
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const token = randomBytes(32).toString('hex');
  const marker = `--aropyt-launch-test=${randomBytes(12).toString('hex')}`;
  const logFile = path.join(directory, 'stderr.log');
  const args = ['-W', '-n', '-g', '-a', bundle, '--stderr', logFile,
    '--stdout', path.join(directory, 'stdout.log')];
  for (const [key, value] of Object.entries({ AROPYT_DATA_DIR: profile,
    AROPYT_TEST_PORT: String(port), AROPYT_TEST_TOKEN: token, RUST_BACKTRACE: '1' })) {
    args.push('--env', `${key}=${value}`);
  }
  args.push(...files, '--args', marker, '-ApplePersistenceIgnoreState', 'YES');
  const launcher = spawn('/usr/bin/open', args, { stdio: 'inherit' });
  let launchEnded = false;
  const exited = new Promise(resolve => launcher.on('exit', code => { launchEnded = true; resolve(code); }));
  const call = async payload => {
    const response = await fetch(`http://127.0.0.1:${port}`, { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(3000) });
    const result = await response.json();
    if (!result.ok) throw Error(result.error);
    return result.value;
  };
  const snapshot = async () => {
    const windows = (await call({ op: 'windows' })).filter(label => label.startsWith('editor-'));
    return Promise.all(windows.map(window => call({ op: 'eval', window,
      code: `window.__aropyt ? {window:${JSON.stringify(window)},file:window.__aropyt.state.file,content:window.__aropyt.getEditor().value,dirty:window.__aropyt.state.dirty,selection:window.__aropyt.getEditor().view.state.selection.main.toJSON()} : null` })));
  };
  const wait = async predicate => {
    const start = Date.now();
    let last;
    while (Date.now() - start < 45000) {
      if (launchEnded) throw Error('Application exited during LaunchServices startup');
      const logs = await readFile(logFile, 'utf8').catch(() => '');
      if (logs.includes('panicked at')) throw Error(logs);
      try { const result = await predicate(); if (result) return result; } catch (error) { last = error; }
      await delay(100);
    }
    throw Error(`Timed out waiting for ${name}: ${last || ''}`);
  };
  let ready = false;
  let failed = false;
  try {
    const documents = await wait(async () => {
      const result = await snapshot();
      return result.length && result.every(Boolean) ? result : false;
    });
    ready = true;
    await check({ documents, call, snapshot, wait });
    const logs = await readFile(logFile, 'utf8');
    assert(!logs.includes('panicked at'), logs);
    passed.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    failed = true;
    console.error(await readFile(logFile, 'utf8').catch(() => ''));
    throw error;
  } finally {
    if (ready) await call({ op: 'quit' }).catch(() => {});
    if (!launchEnded) await Promise.race([exited, delay(5000)]);
    if (!launchEnded) {
      // Even a system restore alert can block setup and the test server. Only
      // terminate the process with this launch's marker, never a user's editor.
      const processes = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
      for (const line of processes.split('\n')) {
        const match = line.match(/^\s*(\d+)\s+(.+)$/);
        if (match?.[2].startsWith(path.join(bundle, 'Contents/MacOS/aropyt') + ' ')
          && match[2].includes(marker)) process.kill(Number(match[1]), 'SIGTERM');
      }
      await Promise.race([exited, delay(3000)]);
      if (!failed) throw Error(`Test application did not exit; evidence: ${directory}`);
    }
  }
}

await checkLaunch('cold-open-multiple-files', [first, second], {
  onLaunch: 'both', lastClosedFiles: [restored],
}, async ({ documents, call, snapshot, wait }) => {
  assert.equal(documents.length, 2, 'Explicit file opens must not create an empty or restored extra window');
  assert.deepEqual(documents.map(doc => doc.file).sort(), [first, second].sort());
  for (const doc of documents) assert.equal(doc.content, fixtures.get(doc.file));
  for (const doc of documents) assert((await call({ op: 'native-window', window: doc.window })).tabCount <= 1,
    'Cold-opened files were automatically merged into native tabs');
  await call({ op: 'eval', window: documents[0].window,
    code: `(()=>{const e=window.__aropyt.getEditor();e.setValue('UNSAVED_ORIGINAL_MUST_SURVIVE');e.view.dispatch({selection:{anchor:2,head:9}});return true})()` });
  const before = await snapshot();
  await run(['-g', '-a', bundle, warm]);
  const after = await wait(async () => {
    const result = await snapshot();
    return result.length === 3 && result.every(Boolean) && result.some(doc => doc.file === warm) ? result : false;
  });
  for (const doc of before) assert.deepEqual(after.find(next => next.window === doc.window), doc,
    'Opening another file changed an existing document, unsaved edit, or selection');
  assert.equal(after.find(doc => doc.file === warm).content, fixtures.get(warm));
  for (const doc of after) assert((await call({ op: 'native-window', window: doc.window })).tabCount <= 1,
    'A new file was opened as a native tab instead of a separate window');
  passed.push('warm-open-creates-independent-window-and-preserves-unsaved-edits');
  console.log('PASS warm-open-creates-independent-window-and-preserves-unsaved-edits');
  await run(['-g', '-a', bundle, warm]);
  const repeated = await wait(async () => {
    const result = await snapshot();
    return result.length === 4 && result.every(Boolean) ? result : false;
  });
  assert.equal(repeated.filter(doc => doc.file === warm).length, 2, 'Opening the same path again did not create a new window');
  for (const doc of before) assert.deepEqual(repeated.find(next => next.window === doc.window), doc);
  for (const doc of repeated) assert((await call({ op: 'native-window', window: doc.window })).tabCount <= 1);
  passed.push('repeated-open-creates-another-independent-window');
  console.log('PASS repeated-open-creates-another-independent-window');
});
await checkLaunch('restore-last-document', [], {
  onLaunch: 'both', lastClosedFiles: [restored],
}, async ({ documents }) => {
  assert.equal(documents.length, 1);
  assert.equal(documents[0].file, restored);
  assert.equal(documents[0].content, fixtures.get(restored));
});
await checkLaunch('plain-application-launch', [], { onLaunch: 'new' }, async ({ documents }) => {
  assert.equal(documents.length, 1);
  assert.equal(documents[0].file, null);
  assert.equal(documents[0].content, '');
});
for (const [file, content] of fixtures) assert.equal(await readFile(file, 'utf8'), content);
const output = path.resolve('release/verification/macos-launch');
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'test-results.json'), JSON.stringify({
  date: new Date().toISOString(), bundle, work, passed,
}, null, 2) + '\n');
console.log(`${passed.length} macOS launch checks passed. Evidence: ${work}`);
