import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import info from '../package.json' with {type:'json'};

const archive=resolve(process.argv[2] ?? '4onv-checkcanary-'+info.version+'.tgz');
const npm=process.env.npm_execpath;
assert.ok(npm,'Run through npm run check:package.');
const directory=await mkdtemp(join(tmpdir(),'checkcanary-package-'));
const invoke=args=>{
  const result=spawnSync(process.execPath,args,{
    cwd:directory,encoding:'utf8',windowsHide:true,timeout:60000,
  });
  assert.equal(result.status,0,result.stderr || String(result.error ?? ''));
  return result.stdout;
};
try {
  invoke([npm,'install','--offline','--ignore-scripts','--no-audit','--no-fund','--package-lock=false',archive]);
  const command=[npm,'exec','--offline','--','checkcanary'];
  assert.equal(invoke([...command,'--version']).trim(),info.version);
  const demo=JSON.parse(invoke([...command,'demo','--json']));
  assert.equal(demo.synthetic,true);
  assert.equal(demo.strong.summary.caught,2);
  assert.equal(demo.weak.summary.survived,2);
  invoke(['--input-type=module','--eval',
    "import {inspectPlan,runPlan} from '@4onv/checkcanary'; if(!inspectPlan || !runPlan) process.exit(1);"]);
  console.log('Offline archive install, installed executable, synthetic canaries and package exports passed.');
} finally {
  await rm(directory,{recursive:true,force:true});
}
