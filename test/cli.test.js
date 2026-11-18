import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const path = relative => fileURLToPath(new URL(relative,import.meta.url));
const cli = path('../bin/checkcanary.js');
const invoke = (...args) => spawnSync(process.execPath,[cli,...args],{
  windowsHide:true,encoding:'utf8',timeout:20000,
});
test('CLI demo is visibly synthetic and demonstrates both verifier outcomes',()=>{
  const human=invoke('demo');
  assert.equal(human.status,0,human.stderr);
  assert.match(human.stdout,/Synthetic verification example/);
  assert.match(human.stdout,/2 caught, 0 survived/);
  assert.match(human.stdout,/0 caught, 2 survived/);
});
test('CLI uses exit codes for passing and surviving canaries and supports metadata-only JSON',()=>{
  const strong=invoke('run',path('../examples/strong.json'),'--json');
  assert.equal(strong.status,0,strong.stderr);
  assert.equal(JSON.parse(strong.stdout).status,'passed');
  const weak=invoke('run',path('../examples/weak.json'),'--json');
  assert.equal(weak.status,1,weak.stderr);
  assert.equal(JSON.parse(weak.stdout).summary.survived,2);
});
test('CLI dry run validates fixtures without executing and invalid input exits 2',()=>{
  const dry=invoke('run',path('../examples/strong.json'),'--dry-run','--json');
  assert.equal(dry.status,0,dry.stderr);
  assert.equal(JSON.parse(dry.stdout).expectedRuns,4);
  assert.equal(invoke('run','does-not-exist.json').status,2);
  assert.equal(invoke('demo','--dry-run').status,2);
});
