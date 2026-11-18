import { spawn } from 'node:child_process';

const maxOutputBytes = 256 * 1024;

function terminate(child) {
  if (!Number.isSafeInteger(child.pid) || child.pid < 1) return;
  if (process.platform === 'win32') {
    const taskkill = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore' });
    taskkill.on('error', () => child.kill());
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
}

export function runCommand(command, cwd, timeoutMs, signal) {
  return new Promise(resolve => {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    delete env.NODE_TEST_CONTEXT;
    const [name, ...args] = command;
    const executable = name === 'node' ? process.execPath : name;
    const started = performance.now();
    const chunks = { stdout: [], stderr: [] };
    let outputBytes = 0;
    let failure = null;
    let settled = false;
    let timer;
    const child = spawn(executable, args, {
      cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32',
      stdio: ['ignore','pipe','pipe'],
    });
    const stop = reason => {
      if (failure) return;
      failure = reason;
      terminate(child);
    };
    const abort = () => stop('cancelled');
    const consume = (stream, name) => {
      stream.on('data', chunk => {
        outputBytes += chunk.length;
        if (outputBytes > maxOutputBytes) stop('output-limit');
        else chunks[name].push(chunk);
      });
      stream.on('error', () => stop('output-read-error'));
    };
    consume(child.stdout, 'stdout');
    consume(child.stderr, 'stderr');
    const finish = (exitCode, errorCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (errorCode) failure ??= errorCode === 'ENOENT' ? 'executable-not-found' : 'spawn-error';
      resolve({ exitCode, failure, stdout: Buffer.concat(chunks.stdout).toString('utf8'),
        stderr: Buffer.concat(chunks.stderr).toString('utf8'), outputBytes,
        durationMs: Math.round(performance.now() - started) });
    };
    child.once('error', error => finish(null, error.code));
    child.once('close', code => finish(code, code === null && !failure ? 'process-signal' : null));
    timer = setTimeout(() => stop('timeout'), timeoutMs);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}
