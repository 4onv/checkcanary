import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectPlan } from '../src/index.js';
import { setup } from './fixtures.js';

test('dry inspection binds file bytes and command settings without executing them', async t => {
  const fixture = await setup(t, (_plan, files) => { files['good.mjs'] = 'throw Error("should never execute");'; });
  const first = await inspectPlan(fixture.manifest);
  assert.equal(first.canaries.length, 1);
  assert.equal(first.expectedRuns, 3);
  assert.equal(first.workspaceFiles, 1);
  assert.match(first.planSha256, /^[a-f0-9]{64}$/u);
  await writeFile(join(fixture.directory,'bad.mjs'),'process.exitCode = 1;');
  const changed = await inspectPlan(fixture.manifest);
  assert.notEqual(changed.planSha256, first.planSha256);
  assert.doesNotMatch(JSON.stringify(first), /good\.mjs|bad\.mjs|should never execute/);
});

test('file paths reject traversal, absolute paths, Windows aliases, case and directory conflicts', async t => {
  for (const files of [{ '../bad': 'good.mjs' }, { 'C:/bad': 'good.mjs' }, { 'NUL.txt': 'good.mjs' },
    { 'a.mjs': 'good.mjs', 'A.mjs': 'good.mjs' }, { a: 'good.mjs', 'a/child': 'good.mjs' }]) {
    const fixture = await setup(t, plan => { plan.files = files; });
    await assert.rejects(inspectPlan(fixture.manifest), /portable relative|distinct portable/);
  }
});

test('canaries require a real change, a bounded nonzero exit and named evidence', async t => {
  const edits = [
    plan => { plan.canaries[0].replace['a.mjs'] = 'good.mjs'; },
    plan => { plan.canaries[0].replace = { 'missing.mjs': 'bad.mjs' }; },
    plan => { plan.canaries[0].expect.exitCode = 0; },
    plan => { plan.canaries[0].expect.outputIncludes = []; },
    plan => { plan.canaries.push(plan.canaries[0]); },
  ];
  for (const edit of edits) {
    const fixture = await setup(t, edit);
    await assert.rejects(inspectPlan(fixture.manifest), /change the bytes|declared workspace|exit code|outputIncludes|unique/);
  }
});

test('fixtures stay within their plan directory even through a symlink', async t => {
  const outside = await setup(t);
  const fixture = await setup(t, plan => { plan.files['a.mjs'] = '../outside.mjs'; });
  await assert.rejects(inspectPlan(fixture.manifest), /portable relative/);
  await writeFile(fixture.manifest, JSON.stringify({
    ...fixture.plan, files: { 'a.mjs': 'alias.mjs' },
  }));
  try {
    await symlink(join(outside.directory,'good.mjs'),join(fixture.directory,'alias.mjs'));
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') { t.skip('Symlink privilege unavailable'); return; }
    throw error;
  }
  await assert.rejects(inspectPlan(fixture.manifest), /outside the plan directory/);
});

test('input shape and bounded UTF-8 and regular-file reads fail before execution', async t => {
  const fixture = await setup(t);
  await writeFile(fixture.manifest, Buffer.from([255]));
  await assert.rejects(inspectPlan(fixture.manifest), /UTF-8 JSON/);
  await writeFile(fixture.manifest, ' '.repeat(512 * 1024 + 1));
  await assert.rejects(inspectPlan(fixture.manifest), /size limit/);
  await writeFile(fixture.manifest, JSON.stringify({ ...fixture.plan, timeoutMs: 0 }));
  await assert.rejects(inspectPlan(fixture.manifest), /timeoutMs/);
  await writeFile(fixture.manifest, JSON.stringify(fixture.plan));
  await writeFile(join(fixture.directory,'good.mjs'), ' '.repeat(256 * 1024 + 1));
  await assert.rejects(inspectPlan(fixture.manifest), /size limit/);
});

test('named-pipe fixtures are rejected promptly', { skip: process.platform === 'win32' }, async t => {
  const fixture = await setup(t);
  execFileSync('mkfifo',[join(fixture.directory,'pipe.mjs')]);
  await writeFile(fixture.manifest, JSON.stringify({ ...fixture.plan, files: { 'a.mjs': 'pipe.mjs' } }));
  await assert.rejects(inspectPlan(fixture.manifest), /regular input file/);
});
