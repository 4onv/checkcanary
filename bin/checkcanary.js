#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inspectPlan, runPlan } from '../src/index.js';

const usage = 'Usage: checkcanary demo [--json]\n' +
  '       checkcanary run PLAN.json [--json] [--dry-run]\n\n' +
  'Exit 0 when all canaries are caught, 1 for surviving defects, or 2 for inconclusive evidence or invalid input.';

function print(report) {
  console.log(JSON.stringify(report.name));
  for (const control of report.controls) {
    console.log('  Control ' + control.phase + '  ' + control.status + '  (' + control.durationMs + ' ms)');
  }
  for (const canary of report.canaries) {
    console.log('  ' + canary.status.toUpperCase() + '  ' + JSON.stringify(canary.id) +
      '  exit=' + canary.exitCode + '  evidence=' + canary.matchedEvidence + '/' + canary.requiredEvidence +
      (canary.reason ? '  ' + canary.reason : ''));
  }
  console.log('  ' + report.status.toUpperCase() + '  ' + report.summary.caught + ' caught, ' +
    report.summary.survived + ' survived, ' + report.summary.unconfirmed + ' unconfirmed');
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' },
    json: { type: 'boolean' }, 'dry-run': { type: 'boolean' },
  } });
  if (values.version) {
    const info = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(info.version);
    return;
  }
  if (values.help || process.argv.length === 2) {
    console.log(usage);
    return;
  }
  const [command, file] = positionals;
  if (!((command === 'demo' && positionals.length === 1 && !values['dry-run']) ||
        (command === 'run' && positionals.length === 2))) throw new Error(usage);
  if (values['dry-run']) {
    const plan = await inspectPlan(file);
    console.log(values.json ? JSON.stringify(plan, null, 2) :
      JSON.stringify(plan.name) + '\nValidated ' + plan.workspaceFiles + ' files and ' +
      plan.canaries.length + ' canaries. Execution would run ' + plan.expectedRuns + ' commands.');
    return;
  }

  const controller = new AbortController();
  let interrupt;
  const stop = signal => {
    interrupt ??= signal === 'SIGINT' ? 130 : 143;
    controller.abort();
  };
  const onInt = () => stop('SIGINT');
  const onTerm = () => stop('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  try {
    if (command === 'demo') {
      const strong = await runPlan(fileURLToPath(new URL('../examples/strong.json', import.meta.url)), { signal: controller.signal });
      const weak = controller.signal.aborted ? null :
        await runPlan(fileURLToPath(new URL('../examples/weak.json', import.meta.url)), { signal: controller.signal });
      if (values.json) console.log(JSON.stringify({ synthetic: true, strong, weak }, null, 2));
      else {
        console.log('Synthetic verification example\n');
        print(strong);
        if (weak) { console.log(''); print(weak); }
      }
      process.exitCode = interrupt ?? (strong.status === 'passed' && weak?.status === 'failed' && weak.summary.survived === 2 ? 0 : 2);
    } else {
      const report = await runPlan(file, { signal: controller.signal });
      if (values.json) console.log(JSON.stringify(report, null, 2));
      else print(report);
      process.exitCode = interrupt ?? { passed: 0, failed: 1, inconclusive: 2 }[report.status];
    }
  } finally {
    process.removeListener('SIGINT', onInt);
    process.removeListener('SIGTERM', onTerm);
  }
}

main().catch(error => {
  console.error(error.code?.startsWith('ERR_PARSE_ARGS') ? usage :
    error.code ? 'Cannot read plan or fixture (' + error.code + ').' : error.message);
  process.exitCode = 2;
});
