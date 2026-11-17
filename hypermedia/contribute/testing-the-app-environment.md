---
name: Testing the app environment
summary: The commands and gates that test the app environment, from unit and smoke tests to the record-and-replay model gate, the live gate against a running server, and blind simulated-model validation.
---
This page is for people changing the [app environment](../software/app-environment.md) code in `apps/`. It lists the test commands, then the three gates that exercise the server with a model in the loop: replay of recorded model responses, a live gate against a running server, and simulated-model validation with no API key. [Development](./development.md) covers the dev loop, and [local CI](./local-ci.md) the repository-wide checks.

# Commands <!-- id:unUpYzoN -->

`apps/` is a Bun workspace. Use Bun commands inside it. <!-- id:hnrbpymM -->

From repo root: <!-- id:cvH06CGz -->

```bash <!-- id:QPisRTbW -->
direnv exec . bash -lc 'cd apps && bun install'
direnv exec . bash -lc 'cd apps && bun src/main.ts'
```

Validation: <!-- id:AamjsE1v -->

```bash <!-- id:rosEGSrU -->
direnv exec . bash -lc 'cd apps && bun check && bun test'
direnv exec . bash -lc 'cd apps && bun run test:build'
direnv exec . bash -lc 'cd apps && bun run test:docker'
direnv exec . bash -lc 'cd apps && bun run test:trigger'
direnv exec . bash -lc 'cd apps && bun run test:outbox'
```

`bun check` typechecks and formats, and `bun test` runs the unit suite, which includes the replay gate below. `test:build` builds the server bundle and boots it. `test:docker` does the same for the Docker image.

# Smoke tests

`test:trigger` boots the real daemon against a local stand-in for hyper.media's `/api/ListEvents`, creates an agent and a user-mention trigger over the [signed API](../build/signed-api.md), and asserts that a comment mention fires exactly one session. It guards the comment and citation sibling race. See [triggers](../agent/triggers.md). <!-- id:PN41rCE- -->

`test:outbox` boots the real daemon on a real SQLite file with a local OpenAI-compatible stand-in for the model and drives the [effect outbox](../agent/effect-outbox.md) over the wire: a memory write leaves a receipt; `kill -9` while a download is in flight and a restart answer the call as interrupted without repeating the download; on macOS the database moves to a 32 MiB RAM disk to show the disk floor pausing dispatch and a real ENOSPC mid-turn failing the run and recovering into one well-formed transcript. `SEED_APPS_SMOKE_REAL_DB=<path>` first boots on a copy of that database so the migration runs against real rows; `SEED_APPS_SMOKE_ONLY=restart,floor` selects scenarios by a word in their names.

# Replay gate (recorded model responses) <!-- id:igk3vJ3Z -->

`apps/e2e/run.ts` drives the real Service through six behavioral gates. By default it **replays** recorded gpt-5-mini responses from `apps/e2e/recordings/`: full service and tool loop, no network, no API key. `apps/src/e2e-replay.test.ts` runs that replay as part of the regular `bun test` suite. Pass `--record` to hit the live OpenAI API and refresh the cassettes. That spends real tokens, so run it manually and never in CI: <!-- id:PaO3tHE2 -->

```bash <!-- id:uOMnss2O -->
cd apps && bun e2e/run.ts all              # replay all scenarios from recordings (offline)
bun e2e/run.ts wf-hello --record             # re-record one scenario live (needs OPENAI_API_KEY)
```

Recording proxies provider traffic through a local server that captures each response keyed by a request fingerprint (model + system-prompt head + last user message + tool names + tool-result count). Replay matches the same fingerprints, so cassettes survive tool-description edits but need re-recording when system prompts or conversation flow change. Only a passing run overwrites a scenario's cassette. The live key comes from `OPENAI_API_KEY` or the repo-root `.keys` file (never committed). Every scenario asserts on durable state (runs, journals, session events) and dumps full transcripts to `apps/e2e-artifacts/<timestamp>/` for prompt autopsies. Scenarios: `chat-smoke`, `sub-basic`, `sub-typed`, `sub-restraint`, `wf-hello`, `todo-adoption`. <!-- id:sqsL6jBF -->

The replay gate skips while the file `apps/e2e/recordings/STALE.md` exists. The file marks cassettes whose fingerprints no longer match the tool surface or the system prompt. With it in place, `bun e2e/run.ts` prints `recordings are STALE … skipping replay`, reports `0 pass, 0 fail (skipped)`, and exits 0, so `src/e2e-replay.test.ts` stays green without covering anything. Do not read a passing `bun test` as evidence that these gates ran: check for that file first. To restore the gate, re-record with `bun e2e/run.ts all --record`, verify every scenario, then delete `STALE.md` and any cassette the re-record did not overwrite.

# Live gate (real server, real model) <!-- id:W2IDueL_ -->

`apps/e2e/live-gate.ts` is the other half. It is a pure client that signs envelopes with the desktop daemon's key over grpc-web, exactly as the desktop app does, and talks CBOR to an already-running server. So it gates the server an operator actually uses, and not an in-process Service. It creates a throwaway `NightGate` agent mirroring an existing agent's provider/model/tools, runs the scenarios, writes full transcripts to an artifact directory, and deletes the agent again. <!-- id:09iIG175 -->

```bash <!-- id:JWUffEVV -->
cd apps
bun e2e/live-gate.ts                                  # every scenario against http://localhost:3051
bun e2e/live-gate.ts trivial memory                   # a subset
bun e2e/live-gate.ts --base http://localhost:3099 --out /tmp/gate --keep
```

Flags: `--base` (app environment), `--daemon` (Seed daemon grpc-web, default `http://localhost:56001`), `--account` (uid to sign as), `--provider` / `--model`, `--like` (agent id to mirror), `--out`, `--timeout` (per-scenario ms, default 600000), `--keep` (leave the NightGate agent behind). <!-- id:2tWMRgpD -->

Scenarios: `trivial` (restraint plus self-naming: arithmetic must be answered directly, with no delegation, and the session still ends up model-titled), `memory` (a fact written to `~/memory` in one session, read back by a second), `parallel-delegate`, `script-parallel`, `script-narration`. Enforced checks are deterministic properties. Model behavior is reported and not asserted. <!-- id:rTsrR0qu -->

This gate spends real tokens and needs a running server with a working provider. It is never part of `bun test`. <!-- id:oBoXgxg8 -->

Two focused companions live beside it. Both are model-free, so they gate a mechanism and not a model: <!-- id:9vBifZNZ -->
  - `e2e/narration-check.ts` drives the script VM directly (no model, no server, no credentials) and asserts that a `ctx.call(tool, input, {description})` label reaches both the durable journal entry and the tool-call adapter. The UI reads the first, and the run transcript reads the second. <!-- id:UOu6RNcR -->
  - `e2e/obligations-live-check.ts` drives a real server over HTTP with a scripted provider (`e2e/scripted-provider.ts`) through the whole unified-obligations loop: a plan-shaped task, a step left open at turn end, the continuation the runtime hands itself, and the settled checklist afterwards. <!-- id:OTtMuLHc -->

# Simulated-model gates (no API key required) <!-- id:kdX10tm6 -->

When a live gate cannot run, and as a repeatable practice for iterating tool prompts, validation uses **blind simulated-model agents**. A fresh LLM session (a Claude Code subagent) gets ONLY what the runtime model sees (the system prompt plus the registry `description`/`inputSchema` of the tools under test, read from `apps/protocol/src/tool-registry.ts`) and asked to produce its exact assistant turns for scripted scenarios. Its tool calls are then validated mechanically: delegation choices checked against intent, declared output schemas run through `validateJsonSchemaShape`, and authored script source run through `lintWorkflowSource` and executed in the real engine (`runWorkflowVM`) against scripted adapters. The simulator's list of contracts it had to guess at is itself a result: each one is a gap in a tool description. The simulator must be **blind** for this to be honest: no access to implementation, docs, or tests, only the model-facing prompt surface. <!-- id:fYBpj9CH -->

# Waiting for background work in tests

- Tests and shutdown wait for the queue via `Service.drainTriggerSessions()`. `awaitQueueIdle()` is an alias for it under the name the runs feature documents. <!-- id:TebiC9QK -->

See the [run queue](../operate/run-queue.md) for what the queue does.

# See also

- [Development](./development.md), the dev loop and commands
- [Local CI](./local-ci.md), the checks to run before a push
- [Contributing](./contributing.md)
- [Deploying](../operate/deploying.md), the workflows that run the app environment test gate before pushing an image
- [Triggers](../agent/triggers.md) and the [effect outbox](../agent/effect-outbox.md), what the two smoke tests guard
- [Prompt](../agent/prompt.md), the model-facing surface the simulated gates test
