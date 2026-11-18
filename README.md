# CheckCanary

**Would your verification command catch a broken feature?** CheckCanary replaces fixture files with deliberate defects, runs your command in a fresh temporary workspace, and requires the expected exit code and named failure evidence.

The bundled synthetic demo runs the same two defects against two test suites. The assertions that check approval and totals catch **2/2**. The suite that checks only the shape of the result catches **0/2**.

## Try the demo

Download the archive and use Node.js 22 or later. The CLI has zero runtime dependencies. [Release and checksums](https://github.com/4onv/checkcanary/releases/latest)

```sh
npm install --global --offline ./4onv-checkcanary-0.1.0.tgz
checkcanary demo
```

The following excerpt shows the controls and defect outcomes. The full command also prints the weak suite's controls and measured durations.

```text
"Synthetic checkout with specific assertions"
  Control before  passed
  Control after   passed
  CAUGHT    "approval-removed"  exit=1  evidence=2/2
  CAUGHT    "wrong-total"       exit=1  evidence=2/2
  PASSED    2 caught, 0 survived, 0 unconfirmed

"Synthetic checkout with shape-only assertions"
  SURVIVED  "approval-removed"  exit=0  evidence=0/2
  SURVIVED  "wrong-total"       exit=0  evidence=0/2
  FAILED    0 caught, 2 survived, 0 unconfirmed
```

All demonstration code and observations above are synthetic. `demo` exits 0 when it reproduces both expected outcomes.

## Keep deliberate defects beside your checks

A plan names the files to copy into each temporary workspace. Keys are workspace destinations. Values are fixture paths relative to the plan. A canary replaces selected files with a known defective version.

```json
{
  "version": 1,
  "name": "Checkout approval verification",
  "command": ["node", "--test", "checks.mjs"],
  "files": {
    "checks.mjs": "strong-checks.mjs",
    "checkout.mjs": "good.mjs"
  },
  "canaries": [
    {
      "id": "approval-removed",
      "replace": { "checkout.mjs": "approval-removed.mjs" },
      "expect": {
        "exitCode": 1,
        "outputIncludes": ["approval gates checkout", "ERR_ASSERTION"]
      }
    }
  ],
  "timeoutMs": 10000
}
```

Copy the [synthetic examples](examples) to start a small verifier project, then replace the fixtures with cases for your own behavior. Choose evidence specific to the check the defect should trigger. A generic failure alone can hide a different broken dependency or a startup crash.

```sh
checkcanary run canaries.json --dry-run
checkcanary run canaries.json
checkcanary run canaries.json --json > canary-results.json
```

Each attempt gets a fresh copy of the original fixture bytes, plus that canary's replacements. The original fixture files stay untouched. A final clean control checks that the original verifier still passes after all defects have run. An optional `baselineEvidence` array requires particular output from each clean control as well as exit 0.

Commands use an executable and arguments without shell expansion. `node` uses the current Node executable. For other languages, put the interpreter on PATH. On Windows, invoke an interpreter or executable directly. Workspace files have ordinary file permissions. Use an interpreter for scripts that need execute permission.

## Read the result in CI

| Outcome | Meaning |
| --- | --- |
| `caught` | The defect produced the configured nonzero exit code and every required evidence string. |
| `survived` | The verifier exited 0 with the defect present. |
| `unconfirmed` | It timed out, crashed at a different check, lacked evidence, exceeded the output bound, or could not start. |

Exit 0 requires every canary to be caught and both clean controls to pass. Exit 1 means at least one defect survived with the remaining evidence complete. Exit 2 means invalid input or inconclusive evidence. Ctrl+C exits 130 after stopping the active command and cleaning its temporary workspace. SIGTERM exits 143.

JSON reports retain the plan fingerprint, IDs, statuses, exit codes, output byte counts, evidence counts and durations. They omit fixture content, command arguments, source paths and raw command output. Plan names and canary IDs remain visible. Required strings must each appear in either stdout or stderr. They are case-sensitive substrings, so select them to identify the intended failure.

A CI step can use `checkcanary run path/to/canaries.json --json` and retain its exit status. The repository's own Windows and Linux workflows test passing, surviving and inconclusive outcomes.

## Scope

CheckCanary replays hand-authored defects in small fixture projects. Test commands run as your user and inherit your environment. They can access the host and network. Review plans and commands before execution. Temporary workspaces isolate the copied input files. Credentials, subprocess behavior and external state follow the tools you run.

There is no automatic mutation generation, dependency installation or build phase. Declare the files your check needs and use tools already installed. A passing report describes the defects and evidence you supplied. It establishes no coverage claim for untested behavior.

Plans are limited to 512 KiB and 50 canaries, with 100 original workspace files. A fixture is at most 256 KiB, and unique loaded fixture bytes total at most 8 MiB. Fixtures must resolve within the plan directory. Each command has a timeout of 100 ms to 120 seconds and a combined output bound of 256 KiB. Normal process trees are stopped on timeout and cancellation. Programs that detach themselves or launch external services need their own cleanup.

## Library and source

```js
import { inspectPlan, runPlan } from "@4onv/checkcanary";

const plan = await inspectPlan("./canaries.json");
const report = await runPlan("./canaries.json");
console.log(plan.expectedRuns, report.summary);
```

```sh
node bin/checkcanary.js demo
npm test
npm pack --ignore-scripts
npm run check:package
```

[November 17 research and three-idea comparison](docs/research-2026-11-17.md) · [MIT License](LICENSE)
