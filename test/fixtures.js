import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function setup(t, edit = () => {}) {
  const directory = await mkdtemp(join(tmpdir(), 'checkcanary-fixture-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = {
    'good.mjs': 'console.log("baseline okay");',
    'bad.mjs': 'console.error("canary detected"); process.exitCode = 1;',
  };
  const plan = {
    version: 1, name: 'Synthetic test verifier', command: ['node','a.mjs'],
    files: { 'a.mjs': 'good.mjs' }, timeoutMs: 5000, baselineEvidence: ['baseline okay'],
    canaries: [{ id: 'known-defect', replace: { 'a.mjs': 'bad.mjs' },
      expect: { exitCode: 1, outputIncludes: ['canary detected'] } }],
  };
  await edit(plan, files, directory);
  for (const [path, content] of Object.entries(files)) await writeFile(join(directory,path),content);
  const manifest = join(directory,'canaries.json');
  await writeFile(manifest, JSON.stringify(plan));
  return { directory, manifest, plan, files };
}
