# These recordings are stale

The cassettes in this directory were recorded against the pre-harness tool surface (`sub_session`, `run_workflow`,
`update_plan`, `memory_*`, `execute_code`, …). The M1 verb collapse (`read`/`write`/`call`/`delegate`/`plan`) changed
tool names and the system prompt, so every replay fingerprint is invalid.

While this file exists, `bun e2e/run.ts` (replay mode) skips with exit 0 and says so, keeping `src/e2e-replay.test.ts`
green without pretending coverage exists.

To restore the gates: run `bun e2e/run.ts all --record` with `OPENAI_API_KEY` set (uses gpt-5-mini; only passing runs
overwrite cassettes), verify all scenarios pass, then delete this file and the old `*.json` cassettes that were not
overwritten.
