import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPlan } from '../src/index.js';
import { setup } from './fixtures.js';

test('synthetic checkout distinguishes weak assertions from checks that catch both defects', async () => {
  const path = name => fileURLToPath(new URL('../examples/' + name + '.json',import.meta.url));
  const strong = await runPlan(path('strong'));
  const weak = await runPlan(path('weak'));
  assert.equal(strong.status, 'passed');
  assert.equal(strong.complete, true);
  assert.deepEqual(strong.summary, { caught: 2, survived: 0, unconfirmed: 0 });
  assert.equal(weak.status, 'failed');
  assert.deepEqual(weak.summary, { caught: 0, survived: 2, unconfirmed: 0 });
  for (const report of [strong,weak]) {
    assert.deepEqual(report.controls.map(row=>row.status), ['passed','passed']);
    assert.doesNotMatch(JSON.stringify(report), /ERR_ASSERTION|node:test|file:\/\/|requires-approval/);
  }
});

test('each attempt runs in a fresh workspace and the source fixtures stay intact', async t => {
  const fixture = await setup(t, (_plan,files) => {
    const prelude = "import { existsSync, writeFileSync } from 'node:fs'; if(existsSync('marker')) throw Error('workspace reused'); writeFileSync('marker','local');";
    files['good.mjs'] = prelude + 'console.log("baseline okay");';
    files['bad.mjs'] = prelude + 'console.error("canary detected"); process.exitCode=1;';
  });
  const original = await readFile(join(fixture.directory,'good.mjs'),'utf8');
  const report = await runPlan(fixture.manifest);
  assert.equal(report.status, 'passed');
  assert.equal(await readFile(join(fixture.directory,'good.mjs'),'utf8'),original);
});

test('wrong exit codes and crashes without the named failure remain unconfirmed', async t => {
  for (const content of ['console.error("different failure"); process.exitCode=1;',
    'console.error("canary detected"); process.exitCode=2;', 'throw Error("private crash text");']) {
    const fixture = await setup(t, (_plan,files) => { files['bad.mjs'] = content; });
    const report = await runPlan(fixture.manifest);
    assert.equal(report.status,'inconclusive');
    assert.equal(report.canaries[0].status,'unconfirmed');
    assert.doesNotMatch(JSON.stringify(report),/different failure|private crash text/);
  }
});

test('evidence must appear in one output stream and raw output stays out of reports', async t => {
  const fixture = await setup(t, (_plan,files) => {
    files['bad.mjs'] = 'process.stdout.write("canary "); process.stderr.write("detected"); process.exitCode=1;';
  });
  const report = await runPlan(fixture.manifest);
  assert.equal(report.status,'inconclusive');
  assert.equal(report.canaries[0].reason,'failure-evidence-missing');
});

test('an invalid initial control prevents canary runs', async t => {
  const fixture = await setup(t, (_plan,files) => { files['good.mjs'] = 'process.exitCode=1;'; });
  const report = await runPlan(fixture.manifest);
  assert.equal(report.status,'inconclusive');
  assert.equal(report.complete,false);
  assert.equal(report.canaries.length,0);
  assert.equal(report.controls.length,1);
});

test('a failing final control prevents a passing verdict', async t => {
  const fixture = await setup(t, (_plan,files,directory) => {
    files['good.mjs'] = "import {existsSync,writeFileSync} from 'node:fs'; const path=" +
      JSON.stringify(join(directory,'control-counter')) +
      "; if(existsSync(path)) process.exitCode=1; else {writeFileSync(path,'seen'); console.log('baseline okay');}";
  });
  const report = await runPlan(fixture.manifest);
  assert.equal(report.canaries[0].status,'caught');
  assert.equal(report.status,'inconclusive');
  assert.equal(report.complete,true);
  assert.deepEqual(report.controls.map(row=>row.status),['passed','failed']);
});

test('spawn failures, timeouts and output floods cannot count as caught defects', async t => {
  const missing = await setup(t, plan => { plan.command=['checkcanary-no-such-executable']; });
  const absent = await runPlan(missing.manifest);
  assert.equal(absent.status,'inconclusive');
  assert.equal(absent.controls[0].reason,'executable-not-found');

  const timeout = await setup(t, (plan,files) => {
    plan.timeoutMs=1500;
    files['bad.mjs'] = 'console.error("canary detected"); setInterval(()=>{},1000);';
  });
  const timed = await runPlan(timeout.manifest);
  assert.equal(timed.status,'inconclusive');
  assert.equal(timed.canaries[0].reason,'timeout');

  const flood = await setup(t, (_plan,files) => {
    files['bad.mjs'] = 'process.stdout.write("canary detected".repeat(100000)); setInterval(()=>{},1000);';
  });
  const excessive = await runPlan(flood.manifest);
  assert.equal(excessive.status,'inconclusive');
  assert.equal(excessive.canaries[0].reason,'output-limit');
});

test('cancellation stops a running attempt and returns incomplete evidence', async t => {
  const fixture = await setup(t, (_plan,files) => {
    files['bad.mjs'] = 'setInterval(()=>{},1000);';
  });
  const controller = new AbortController();
  const report = await runPlan(fixture.manifest,{signal:controller.signal,onProgress:event=>{
    if(event.phase==='canary' && event.status==='start') setTimeout(()=>controller.abort(),100);
  }});
  assert.equal(report.status,'inconclusive');
  assert.equal(report.complete,false);
  assert.equal(report.canaries[0].reason,'cancelled');
});
