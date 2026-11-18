import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { loadPlan } from './plan.js';
import { runCommand } from './process.js';

function overview(plan) {
  return { schemaVersion: 1, name: plan.name, planSha256: plan.planSha256,
    canaries: plan.canaries.map(canary => ({ id: canary.id,
      changedFiles: Object.keys(canary.replacements).length, evidenceCount: canary.expect.outputIncludes.length })),
    workspaceFiles: Object.keys(plan.files).length, expectedRuns: plan.canaries.length + 2, timeoutMs: plan.timeoutMs };
}

export async function inspectPlan(file) {
  return overview(await loadPlan(file));
}

async function attempt(plan, files, signal) {
  const directory = await mkdtemp(join(tmpdir(), 'checkcanary-'));
  try {
    for (const [path, bytes] of Object.entries(files)) {
      const target = join(directory, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    return await runCommand(plan.command, directory, plan.timeoutMs, signal);
  } finally {
    const absolute = resolve(directory);
    if (!absolute.startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected temporary workspace path.');
    await rm(absolute, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

function outcome(result, required) {
  return { exitCode: result.exitCode, durationMs: result.durationMs, outputBytes: result.outputBytes,
    requiredEvidence: required.length,
    matchedEvidence: required.filter(text => result.stdout.includes(text) || result.stderr.includes(text)).length,
    ...(result.failure ? { reason: result.failure } : {}) };
}

export async function runPlan(file, { signal, onProgress = () => {} } = {}) {
  const plan = await loadPlan(file);
  const report = { ...overview(plan), createdAt: new Date().toISOString(), status: 'inconclusive',
    complete: false, controls: [], canaries: [], summary: { caught: 0, survived: 0, unconfirmed: 0 } };
  const control = async phase => {
    onProgress({ phase, status: 'start' });
    const result = await attempt(plan, plan.files, signal);
    const row = { phase, ...outcome(result, plan.baselineEvidence) };
    row.status = !result.failure && result.exitCode === 0 && row.matchedEvidence === row.requiredEvidence ? 'passed' : 'failed';
    report.controls.push(row);
    onProgress({ phase, status: row.status });
    return row.status === 'passed';
  };
  if (signal?.aborted) return report;
  if (!await control('before')) return report;

  for (const canary of plan.canaries) {
    if (signal?.aborted) return report;
    onProgress({ phase: 'canary', id: canary.id, status: 'start' });
    const result = await attempt(plan, { ...plan.files, ...canary.replacements }, signal);
    const row = { id: canary.id, ...outcome(result, canary.expect.outputIncludes),
      expectedExitCode: canary.expect.exitCode };
    row.status = 'unconfirmed';
    if (!result.failure && result.exitCode === 0) row.status = 'survived';
    else if (!result.failure && result.exitCode === canary.expect.exitCode &&
        row.matchedEvidence === row.requiredEvidence) row.status = 'caught';
    if (!row.reason && row.status === 'unconfirmed') {
      row.reason = result.exitCode !== canary.expect.exitCode ? 'unexpected-exit-code' : 'failure-evidence-missing';
    }
    report.canaries.push(row);
    report.summary[row.status]++;
    onProgress({ phase: 'canary', id: canary.id, status: row.status });
  }
  if (signal?.aborted) return report;
  const after = await control('after');
  report.complete = true;
  if (after && !report.summary.unconfirmed) report.status = report.summary.survived ? 'failed' : 'passed';
  return report;
}
