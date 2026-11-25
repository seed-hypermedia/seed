---
name: Testing the app environment
summary: This page lists the commands and gates that test the app environment, from unit and smoke tests to the replay of recorded model answers, the live gate against a running server, and tests with a simulated model.
---
This page is for people who change the code of the [app environment](../software/app-environment.md) in `apps/`. It lists the test commands first. Then it describes three gates. A gate is a test that must pass before a change ships. These three test the server together with a model:

- The replay gate uses recorded model answers.
- The live gate uses a running server and a real model.
- The simulated-model gate uses no API key.

[Development](./development.md) covers the daily commands, and [local CI](./local-ci.md) covers the checks for the whole repository.

# Commands <!-- id:unUpYzoN -->

`apps/` is a Bun workspace. Use Bun commands inside it. <!-- id:hnrbpymM -->

From the root of the repository, install and start the server: <!-- id:cvH06CGz -->

```bash <!-- id:QPisRTbW -->
direnv exec . bash -lc 'cd apps && bun install'
direnv exec . bash -lc 'cd apps && bun src/main.ts'
```

Run the checks: <!-- id:AamjsE1v -->

```bash <!-- id:rosEGSrU -->
direnv exec . bash -lc 'cd apps && bun check && bun test'
direnv exec . bash -lc 'cd apps && bun run test:build'
direnv exec . bash -lc 'cd apps && bun run test:docker'
direnv exec . bash -lc 'cd apps && bun run test:trigger'
direnv exec . bash -lc 'cd apps && bun run test:outbox'
```

`bun check` runs the type checker and the formatter. `bun test` runs the unit suite, which includes the replay gate below. `test:build` builds the server bundle and starts it. `test:docker` does the same for the Docker image.

# Smoke tests

A smoke test starts the real program and checks that one important path works. These two start the real app environment server, the same `main.ts` that the deployment image runs. They do not start a Seed daemon.

`test:trigger` starts the real server against a local fake of hyper.media's `/api/ListEvents`. It creates an [agent](../agent.md) and a user-mention [trigger](../trigger.md) over the [signed API](../build/signed-api.md). Then it checks that a mention in a [comment](../protocol/comments.md) starts exactly one session. It guards against the race between a comment and the citation it creates. See [triggers](../agent/triggers.md). <!-- id:PN41rCE- -->

`test:outbox` starts the real server on a real SQLite file, with a local fake model that speaks the OpenAI API. It tests the [effect outbox](../agent/effect-outbox.md) through real requests. Its scenarios include these:

- A memory write leaves a receipt.
- The test runs `kill -9` while a download is running and then restarts the server. The server answers the call as interrupted and does not repeat the download.
- On macOS, the test moves the database to a 32 MiB RAM disk. It shows that the server stops giving out work when the disk is almost full. It also shows that a real "no [space](../protocol/spaces.md) left" error (ENOSPC) in the middle of a turn fails the run, and that the server recovers with one complete transcript.

Two variables change what runs. `SEED_APPS_SMOKE_REAL_DB=<path>` first starts the server on a copy of that database, so the migration runs against real rows. `SEED_APPS_SMOKE_ONLY=restart,floor` selects scenarios by a word in their names.

# Replay gate (recorded model responses) <!-- id:igk3vJ3Z -->

`apps/e2e/run.ts` runs the real `Service` class through six scenarios. By default it **replays** recorded gpt-5-mini answers from `apps/e2e/recordings/`. The whole server and the tool loop run, with no network and no API key. A file of recorded answers is called a cassette. `apps/src/e2e-replay.test.ts` runs that replay as part of the normal `bun test` suite. Pass `--record` to call the real OpenAI API and record new cassettes. That spends real tokens, so run it by hand and never in CI: <!-- id:PaO3tHE2 -->

```bash <!-- id:uOMnss2O -->
cd apps && bun e2e/run.ts all              # replay all scenarios from recordings (offline)
bun e2e/run.ts wf-hello --record             # re-record one scenario live (needs OPENAI_API_KEY)
```

How recording and replay work: <!-- id:sqsL6jBF -->

- When it records, the script sends the traffic to the model provider through a local server. That server saves each answer under a fingerprint of the request: the model, the start of the system prompt, the last user message, the tool names and the number of tool results.
- Replay looks up the same fingerprints. So a cassette still works after you edit a tool description. You must record again when a system prompt or the flow of the conversation changes.
- Only a run that passes replaces the cassette of a scenario.
- The key for recording comes from `OPENAI_API_KEY`, or from the `.keys` file at the root of the repository, which is never committed.
- Every scenario checks durable state: [runs](../agent/runs.md), [journals](../agent/journal.md) and session events. It writes full transcripts to `apps/e2e-artifacts/<timestamp>/`, so you can study the prompts afterwards.

The scenarios are `chat-smoke`, `sub-basic`, `sub-typed`, `sub-restraint`, `wf-hello` and `todo-adoption`.

The replay gate skips while the file `apps/e2e/recordings/STALE.md` exists. The file marks cassettes whose fingerprints no longer match the tools or the system prompt. While it is there, `bun e2e/run.ts` prints `recordings are STALE … skipping replay`, reports `0 pass, 0 fail (skipped)`, and exits with 0. So `src/e2e-replay.test.ts` passes and tests nothing. A passing `bun test` does not prove that these gates ran. Look for that file first. To bring the gate back:

1. Record again with `bun e2e/run.ts all --record`.
2. Check every scenario.
3. Delete `STALE.md`, and delete any cassette that the new recording did not replace.

# Live gate (real server, real model) <!-- id:W2IDueL_ -->

`apps/e2e/live-gate.ts` is the other half. It is only a client. It signs its requests with a key that the [Seed daemon](../software/daemon.md) of the [desktop app](../software/desktop.md) holds, over gRPC-web, exactly as the desktop app does. It sends CBOR to a server that is already running. So it tests the server that a person really uses, and not a `Service` object inside the test process. It works in four steps: <!-- id:09iIG175 -->

1. It creates a throwaway agent named `NightGate`, with the provider, model and tools of an existing agent.
2. It runs the scenarios.
3. It writes full transcripts to an output directory.
4. It deletes the agent.

```bash <!-- id:JWUffEVV -->
cd apps
bun e2e/live-gate.ts                                  # every scenario against http://localhost:3051
bun e2e/live-gate.ts trivial memory                   # a subset
bun e2e/live-gate.ts --base http://localhost:3099 --out /tmp/gate --keep
```

Flags: `--base` (the app environment), `--daemon` (the gRPC-web address of the Seed daemon, default `http://localhost:56001`), `--account` (the [account](../protocol/identity.md) id to sign as), `--provider` / `--model`, `--like` (the id of the agent to copy), `--out`, `--timeout` (milliseconds for each scenario, default 600000), `--keep` (do not delete the NightGate agent). <!-- id:2tWMRgpD -->

Scenarios: `trivial` (the agent must answer a sum directly, with no delegation, and the model must still give the session a title), `memory` (one session writes a fact to `~/memory`, and a second session reads it back), `parallel-delegate`, `script-parallel`, `script-narration`. A check that can fail the gate tests a property that is always true or always false. The gate reports what the model chose to do, but it does not fail on it. <!-- id:rTsrR0qu -->

This gate spends real tokens, and it needs a running server with a working provider. It is never part of `bun test`. <!-- id:oBoXgxg8 -->

Two smaller scripts are beside it. Neither uses a model, so each tests a mechanism and not a model: <!-- id:9vBifZNZ -->
  - `e2e/narration-check.ts` runs the script VM directly, with no model, no server and no credentials. It checks that the label of a `ctx.call(tool, input, {description})` reaches both the durable journal entry and the tool-call adapter. The UI reads the first, and the run transcript reads the second. <!-- id:UOu6RNcR -->
  - `e2e/obligations-live-check.ts` runs a real server over HTTP with a fake provider that gives scripted answers (`e2e/scripted-provider.ts`). It goes through the whole obligations loop: a task with a [plan](../agent/plan.md), a step that is still open when the turn ends, the next turn that the runtime starts by itself, and the finished checklist afterwards. <!-- id:OTtMuLHc -->

# Simulated-model gates (no API key required) <!-- id:kdX10tm6 -->

Use this gate when the live gate cannot run, and when you improve tool prompts step by step. Another model plays the part of the runtime model. This is a **blind simulated-model agent**. <!-- id:fYBpj9CH -->

1. Start a new LLM session, for example a Claude Code subagent.
2. Give it ONLY what the runtime model sees: the system prompt, and the `description` and `inputSchema` of the tools under test, read from `apps/protocol/src/tool-registry.ts`.
3. Ask it to write its exact assistant turns for scripted scenarios.
4. Check its tool calls with code:
   - Compare each choice to delegate with what the scenario intends.
   - Run each output schema it declares through `validateJsonSchemaShape`.
   - Run each script it writes through `lintWorkflowSource`, then run the script in the real engine (`runWorkflowVM`) against scripted adapters.

The simulator also lists the contracts it had to guess. That list is a result too: each item is a gap in a tool description.

The simulator must be **blind**, or the test is not honest. It gets no access to the implementation, the docs or the tests. It sees only the text that the model sees.

# Waiting for background work in tests

- Tests and shutdown wait for the queue with `Service.drainTriggerSessions()`. `awaitQueueIdle()` is a second name for the same function. <!-- id:TebiC9QK -->

See the [run queue](../operate/run-queue.md) for what the queue does.

# See also

- [Development](./development.md), the daily commands and conventions
- [Local CI](./local-ci.md), the checks to run before a push
- [Contributing](./contributing.md)
- [Deploying](../operate/deploying.md), the workflows that run the app environment tests before they push an image
- [Triggers](../agent/triggers.md) and the [effect outbox](../agent/effect-outbox.md), what the two smoke tests guard
- [Prompt](../agent/prompt.md), the text the model sees, which the simulated gate tests
