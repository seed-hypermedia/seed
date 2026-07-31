# Tool system: actions, the registry, and progressive discovery

Design-stage document (see [readme.md](./readme.md)). This doc owns the action data model and its Onyx typing, the
registry that replaces `seedToolRegistry`, progressive discovery (including code-mode `run_code`), lambdas, migration
from the current code, MCP posture, validation plumbing, skills/bundles, and the cross-account request placeholder. Run
records, workflow semantics, and sub-agent execution are owned by [orchestration.md](./orchestration.md); permission
gates on the self-configuration actions are owned by [self-configuration.md](./self-configuration.md); the
thread/one-input surface is owned by [context-and-threads.md](./context-and-threads.md).

## Overview

Today's tool system is a compile-time object literal (`agents/protocol/src/tool-registry.ts`) with a hand-rolled
JSON-Schema dialect, a dead `outputSchema`, and four-plus code touch points per tool
(`agents/src/api-service.ts:1670-1686` name-filter chain, `createAgentServicePiTools()` at `:3688`, the
`SeedToolRegistry` type key, and prompt tool-group lists). Every enabled tool's full definition is serialized into every
request.

The redesign makes the **action** the single callable unit — `{name, description, input, output, kind}` where
`kind ∈ {builtin, lambda, agent, workflow}` — typed end-to-end by Onyx, stored as rows in SQLite, content-addressed as
DAG-CBOR blocks, and publishable as Seed Hypermedia documents. The registry becomes data; adding a builtin becomes one
registration call plus one data file; lambdas make user/agent-defined actions first-class; and Pi's already-shipped
`setActiveToolsByName()` turns the registry into a progressively-discovered surface instead of a fixed prompt tax.

## (a) The Action record

### The discriminated union

Following the `hypermedia-op` pattern from `feat/onyx:onyx/hypermedia-op.json` — an `anyOf` union whose variants are
closed maps tagged by a single-value `enum` — the action record is a four-variant union. Schemas publish under the Seed
authority (placeholder `hm://<seed>/…` below; the concrete account is an open question):

```json
{
  "name": "Seed action",
  "description": "A callable unit of agent work — builtin tool, sandboxed lambda, agent run, or workflow — discriminated on kind.",
  "anyOf": [
    {"ref": "hm://<seed>/seed-action-builtin"},
    {"ref": "hm://<seed>/seed-action-lambda"},
    {"ref": "hm://<seed>/seed-action-agent"},
    {"ref": "hm://<seed>/seed-action-workflow"}
  ]
}
```

Every variant repeats the shared callable core (Onyx composes by ref + refinement, not `extends`; whether the
meta-schema's `include` variant can dedup these fields is an open question):

| field         | type                                                 | notes                                                                                                                                        |
| ------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`        | single-value `enum`                                  | the union tag                                                                                                                                |
| `name`        | string                                               | registry-local name, e.g. `search`, `acme/summarize-pr`                                                                                      |
| `summary`     | string                                               | **one line, ≤120 chars** — what search results and prompt indexes show                                                                       |
| `description` | string                                               | full model-facing description, loaded only when the action is active                                                                         |
| `input`       | Onyx schema (value conforms to `hm://<onyx>/schema`) | inline schema, or just `{"ref": "hm://…"}` — a bare ref is itself a valid Onyx schema, so pointing at a published schema costs nothing extra |
| `output`      | Onyx schema                                          | same; **validated at runtime**, unlike today's dead `outputSchema`                                                                           |
| `render`      | optional map, `ref: hm://<seed>/seed-action-render`  | declarative UI metadata (below)                                                                                                              |
| `tags`        | optional list of strings                             | replaces the hardcoded prompt tool-group lists; groups like `memory`, `hypermedia`, `web`                                                    |

The lambda variant in full (dag-json):

```json
{
  "name": "Lambda action",
  "description": "A user- or agent-defined code action executed in the microVM sandbox.",
  "type": "hm://<onyx>/map",
  "required": ["kind", "name", "summary", "description", "input", "output", "code", "runtime"],
  "properties": {
    "kind": {"type": "hm://<onyx>/string", "enum": ["lambda"]},
    "name": {"type": "hm://<onyx>/string"},
    "summary": {"type": "hm://<onyx>/string"},
    "description": {"type": "hm://<onyx>/string"},
    "input": {"ref": "hm://<onyx>/schema"},
    "output": {"ref": "hm://<onyx>/schema"},
    "code": {"type": "hm://<onyx>/link"},
    "runtime": {"type": "hm://<onyx>/string", "enum": ["javascript", "python"]},
    "limits": {
      "type": "hm://<onyx>/map",
      "required": [],
      "properties": {
        "cpus": {"type": "hm://<onyx>/integer"},
        "memoryMib": {"type": "hm://<onyx>/integer"},
        "timeoutSecs": {"type": "hm://<onyx>/integer"},
        "network": {"type": "hm://<onyx>/boolean"}
      }
    },
    "render": {"ref": "hm://<seed>/seed-action-render"},
    "tags": {"type": "hm://<onyx>/list", "items": {"type": "hm://<onyx>/string"}}
  }
}
```

**Sketch convention.** Schema sketches in this doc use the real seven-variant meta-schema vocabulary
(`feat/onyx:onyx/onyx-*-schema.json`): `type` carrying a kind URL, `properties`/`required` for maps (optionality =
omission from `required`), `values` for open maps, `items`, `anyOf`, and single-value `enum` tags. There is **no
declared discriminator keyword** — union discrimination is the single-value-enum convention (as `hypermedia-op` proves)
— so a value failing a union validates as a per-variant error list, which §(g) must compensate for. Sibling docs' schema
sketches (`orchestration.md`'s journal union, `context-and-threads.md`'s router I/O, `self-configuration.md`'s Flow 2)
are pseudo-syntax until normalized to this convention.

Variant-specific fields:

- **builtin**: `impl: string` — the executor-binding key (usually equal to `name`); the Bun service refuses to boot if a
  builtin row has no registered executor or vice versa. Optionally `implVersion` so a definition edit that changes
  semantics forces a matching code change.
- **lambda**: `code` (IPFS link to the module blob — content-addressed independently of the record so two lambdas can
  share code), `runtime`, `limits` (clamped to service maxima, never trusted as grants).
- **agent**: `agent` (hm:// agent ref or local agent id), plus delegation fields (`instructions` template, model
  override). Execution semantics — how an agent-kind call becomes a run — are owned by
  [orchestration.md](./orchestration.md); this doc only fixes the record shape so agents are callable like any tool.
- **workflow**: `source` (IPFS link to the workflow JS module — the name orchestration.md already uses; since the record
  is content-addressed, this field name is CID-affecting and both docs must agree). Resume/journaling semantics in
  [orchestration.md](./orchestration.md).

Because the record is a closed map of IPLD values, it canonically DAG-CBOR-encodes to a CIDv1. **The CID is the
version.** `hm://` names are mutable pointers for discovery; execution pins a CID (see security).

### Render metadata's future

`ToolRenderMetadata` (`tool-registry.ts:43-55`) is a load-bearing strength (registry-driven UI bubbles) and survives
almost unchanged — it is already declarative data (`kind`, `label`, `color`, `primaryArg`, `links`, `details`,
`customViews`), so it moves into the action record typed by a `seed-action-render` Onyx schema. Two consequences:

1. **Network actions get UI for free**: an imported action carries its render block, so a lambda someone else published
   renders as a proper bubble, not raw JSON. Untrusted render metadata is display-only (labels/paths), never executed.
2. **`getReferencedUrls` cannot be content-addressed** (it is a function). It is replaced by a declarative
   `references: [{source: 'input'|'output', path: string}]` list — the existing `ToolRenderLink` shape already proves
   paths cover most cases. The two genuinely computed extractors (`write`'s command-dependent URLs) keep a code-side
   extractor registered by action name during migration; long-term the `write` split (below) dissolves them.

Lambdas default to `render: {kind: 'generic', label: <name>, color: 'muted'}` unless the author supplies one.

## (b) The registry

### Storage

The registry is SQLite, account-scoped like everything else in the schema (`agents/src/sqlite.ts` /
`sqlite-schema.sql`):

```sql
CREATE TABLE actions (
  account_id     TEXT NOT NULL,
  name           TEXT NOT NULL,              -- registry-local unique name
  cid            TEXT NOT NULL,              -- CIDv1 of the canonical DAG-CBOR action record (current version)
  kind           TEXT NOT NULL CHECK (kind IN ('builtin','lambda','agent','workflow','skill')),
                                              -- 'skill' rows are registry data, never dispatched (§h);
                                              -- the callable action union stays four-variant
  definition_cbor BLOB NOT NULL,             -- the action record, canonical encoding
  status         TEXT NOT NULL DEFAULT 'draft',   -- draft | active | paused | disabled | archived
  origin         TEXT NOT NULL,              -- 'builtin' | 'local' | source URL ('hm://…' import, 'mcp://…' bridge)
  published_doc  TEXT,                       -- hm:// doc URL once published (NULL = unpublished)
  prompt_tokens  INTEGER,                    -- measured cost of the serialized model-facing definition
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (account_id, name)
);
CREATE UNIQUE INDEX actions_by_cid ON actions (account_id, cid);

-- Append-only version history: every UpdateAction inserts here first.
CREATE TABLE action_versions (
  account_id TEXT NOT NULL, name TEXT NOT NULL, cid TEXT NOT NULL,
  definition_cbor BLOB NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, cid)
);

-- Search index over the summary tier (never the full description of deferred actions).
CREATE VIRTUAL TABLE actions_fts USING fts5(name, summary, tags, description);
```

**Status lifecycle** (aligned with [self-configuration.md](./self-configuration.md)'s create-cheap/activate-guarded
principle): agent- and user-created rows are born `draft` — runnable only by their creator (test calls, dry runs),
**excluded from `action_search`/`ListActions` for everyone else** (the FTS index is unconditional; visibility filtering
happens at query time on `status` + creator). `active` is the discoverable state, reached via the publish/activate gates
self-configuration.md defines. `paused` is the automatic suspension state for objects exceeding their spend limits (its
Spend-limits section); `disabled` is manual; `archived` is the tombstone. Builtins upsert directly as `active` — they
ship reviewed.

Builtins are **also rows**: at boot the service encodes each bundled builtin definition, compares CIDs against the
stored rows, and upserts (an app upgrade that changes a builtin's schema shows up as a normal version bump in
`action_versions`). The executor table lives in code:

```ts
// agents/src/actions/builtins.ts — the ONE code touch point per builtin
registerBuiltin(defs.search, (ctx, input) => executeAgentServiceSearch(ctx, input))
registerBuiltin(defs.read, (_ctx, input) => readHypermedia(input))
// boot check: every builtin def has an executor, every executor has a def — fail fast otherwise.
```

### Protocol additions

New signed actions (shapes here; permission gating in [self-configuration.md](./self-configuration.md)): `CreateAction`,
`UpdateAction` (new version; old CID archived), `SetActionStatus`, `ListActions` (with `kind`/`status` filters and
summaries only), `GetAction` (full record), `PublishAction`, `ImportAction` (from an hm:// doc or ipfs:// CID). WS:
reuse the existing `change` event with `reason: 'actions-changed'` so the desktop invalidates its registry query — same
pattern as `agent-memory-changed` today (`api-service.ts:1649`).

**Relation to the `config.*` actions.** These signed actions are the user-facing protocol path (desktop UI, CLI).
self-configuration.md's agent-callable `config.create_lambda` / `config.update_lambda` / `config.publish_lambda` /
`config.create_workflow` / `config.publish_action_doc` are **wrappers over the same internal handlers** with an `actor`
parameter — the exact pattern its migration section establishes for `CreateAgent` — gated by the capabilities named in
its table (`config.lambdas.write`/`.publish`, `config.workflows.write`, `config.registry.publish`). There is no separate
`create_action` capability; when this doc says an operation is permission-gated, the gate is one of those rows. Gap to
close there: `ImportAction` has no capability row yet — imports need one (proposed `config.imports.install`, default
`ask`) since an import is an install (see security).

### Publishing and naming

An action publishes as a Hypermedia document exactly the way Onyx schemas do (the `schemaDefinition`/`schema` metadata
patterns, `feat/onyx:onyx/README.md`):

- The action doc sets `schema: hm://<seed>/seed-action` (it _conforms to_ the action union) and carries the action
  record as its typed content; its input/output schemas may themselves be published schema docs referenced by URL.
- **`hm://<account>/<path>` is the stable, mutable name** — what discovery, docs, and agent configuration use.
- **`ipfs://<cid>` is the pinned version** — what execution journals record (see
  [orchestration.md](./orchestration.md)'s deterministic-resume: a resumed workflow must re-run the _same_ lambda code,
  so journal entries pin CIDs, never names).

This split falls out of Onyx's existing reference forms for free — no new mechanism.

### Account-scoped vs network-shared

Three tiers: (1) **builtin** — shipped with the service, same for every account; (2) **local** — created via
`CreateAction` in this account, private until published; (3) **imported** — `ImportAction` copies a published action doc
into the local registry with `origin` recording the source URL and the imported CID pinned. Imports of executable kinds
(lambda, workflow) are install events requiring explicit user consent (see security); imports never auto-update — a
newer published version surfaces as an available upgrade, applied by a fresh consent.

### Per-agent enablement

`AgentDefinition.tools?: string[]` (bare names, unknowns silently dropped at `api-service.ts:1670`) becomes:

```ts
type ActionSelector = string /* name, hm:// or ipfs:// */ | {ref: string; config?: Record<string, unknown>}
type AgentDefinition = {/* … */ actions?: ActionSelector[]; coreActions?: ActionSelector[]}
```

Unknown refs are rejected at agent-save time against the registry — a validation error, not a silent drop. `actions` is
the agent's _discoverable_ set (searchable, loadable); `coreActions` overrides the default always-loaded core.
Per-selector `config` finally gives `userConfigurable` teeth (e.g. pinning `write`'s allowed commands).

## (c) Progressive discovery

### The core set

The always-loaded core must be small enough that its prompt cost is negligible and universal enough that no session
stalls waiting for discovery. Proposed default:

1. **`action_search`** — mandatory: without it nothing else is findable.
2. **`load_actions`** — mandatory: the activation half of the pair.
3. **`read`** — nearly every session touches an hm:// URL (window context, mentions, trigger payloads); its schema is
   tiny; it is today's only default tool (`definition.tools === undefined ⇒ [read]`, `api-service.ts:1667`).
4. **`memory`** — the five memory tools (`memory_list/read/write/delete/download`) collapse into one namespaced router
   action (the `write` 22-command pattern, applied deliberately this time, with a per-command input union in Onyx).
   Memory is identity-critical — the system prompt already injects a memory listing, and an agent that must _search_ for
   the ability to read its own memory is broken.
5. **`set_session_title`** — trivial and hidden; once [context-and-threads.md](./context-and-threads.md)'s thread model
   lands it persists as a thread rename via the durable `thread_renamed` event, and it retires when system jobs
   (first-exchange titling, compaction) append that event directly (that doc's §A).

Deliberately **not** core: `write` (the single largest schema in the registry — its 22-command definition dominates
today's ~8-10 KB tool prompt — and used in a minority of turns), `web_search`/`web_read`, `execute_code`, the
ipfs/attachment family, and all lambdas/agents/workflows. Core is expected to serialize under ~2 KB versus today's ~8-10
KB always-on cost.

This list is the **default** core; the ~2 KB CI assertion applies to it. Agents extend or replace it via the
`coreActions` override in §(b) — in particular, [self-configuration.md](./self-configuration.md)'s root agent uses
`coreActions` to add `search` (the hypermedia search builtin), `config.read`, and its `config.help` meta-action; that
agent's core carries its own measured budget rather than the default assertion.

### The discovery pair

```
action_search:
  input:  {query: string, kind?: enum, tags?: [string], limit?: integer}
  output: {results: [{ref, name, kind, summary, signature, promptTokens, loaded: boolean}]}

load_actions:
  input:  {refs: [string], unload?: [string]}
  output: {loaded: [string], activePromptTokens: integer, notice: 'active for your next step'}
```

- `signature` is a compact one-line rendering generated from the Onyx schemas —
  `(query: string, pageSize?: integer) → {results: list}` — so the model can often decide without loading. Search
  returns **summaries only**; the full `description` + full input schema enter the prompt only after `load_actions`.
- `load_actions` maps directly onto Pi's shipped-but-unused primitives: resolve refs → construct/lookup Pi
  `ToolDefinition`s → `session.setActiveToolsByName(names)` (`current-system-analysis.md` §tool-system).
- **Pi's registry is fixed at session construction** ("Only tools in the registry can be enabled. Unknown tool names are
  ignored" — `agent-session.d.ts`; there is no public mid-session registration API). Consequences the design must own:
  - Every run **pre-constructs Pi `ToolDefinition`s for the agent's entire discoverable set** (potentially hundreds of
    rows). This is cheap — rows → defs is deserialization, no I/O — but it is a named per-run cost, and it is the
    mechanism that makes `setActiveToolsByName` sufficient for activation.
  - `load_actions` **validates refs against the SQLite registry itself** and returns a structured error for unknown
    refs. It never leans on Pi's silent-ignore, which would reproduce exactly the "unknown names silently dropped"
    defect this redesign exists to fix.
  - An action created mid-run (`config.create_lambda`) is absent from the session's pre-constructed registry. Because
    `load_actions` resolves against SQLite (where the new row exists), the executor handles this via the same
    loop-restart path as activation timing (next bullet): rebuild the tool registry from current rows on restart, so
    create → load → call still completes within one user turn. If a restart is impossible at that point, the ref returns
    a structured error with "available on your next run" guidance — never a silent no-op.
- **Activation timing is pinned: same user turn.** Activation MUST apply to the next provider request _inside the same
  agent loop_, so search → load → call completes without a user round-trip. Pi rebuilds the system prompt on
  `setActiveToolsByName`; if that rebuild only takes effect on a fresh `agent.continue()`, the executor transparently
  restarts the loop after `load_actions` (replay-safe: the durable `actions_loaded` event below makes reconstruction
  deterministic). The `notice` text says "next step", meaning the next model request — never "next turn" in the
  user-visible sense, which would make discovery a two-phase chore.
- **Durability**: each successful `load_actions` appends an `actions_loaded` session event (refs + pinned CIDs). Replay
  in `#piMessages()`/run-start reconstructs the active set deterministically — a resumed run sees exactly the tools it
  had, at the versions it had (this is the same journal discipline orchestration.md applies to action calls). Active-set
  reconstruction **scans the full event log regardless of compaction boundaries**:
  [context-and-threads.md](./context-and-threads.md)'s boundary excludes events from _model context_, not from
  control-state reads, and `actions_loaded` events are never model-facing — so a post-compaction run keeps its loaded
  set. (Compaction never deletes events, so the scan is always possible.)
- Lambda/agent/workflow kinds are loadable identically: to Pi they are all just `ToolDefinition`s whose `execute` is the
  kind-appropriate executor (sandbox call, run spawn, workflow start).

### Prompt-cost accounting

`prompt_tokens` is measured at registration time (serialize the model-facing definition — name + description + JSON
Schema projection — through a cheap tokenizer estimate) and surfaced in three places: `action_search` results (the model
can weigh cost), `load_actions` output (`activePromptTokens` running total against a per-agent budget, default ~6 K
tokens, over-budget loads require an `unload`), and run records ([orchestration.md](./orchestration.md)) so usage
finally attributes context spend to tool definitions vs conversation.

### Code-mode: `run_code`, ephemeral orchestration without registration

Progressive discovery cuts the cost of tool _definitions_; it does nothing for tool _data_. A fan-out over 200 documents
otherwise round-trips every intermediate result through model context — the exact cost that Anthropic's programmatic
tool calling, Cloudflare's Code Mode, and Claude Code's bash+CLI pattern eliminate by letting the model write a one-shot
script that calls tools in a loop. The registered-workflow path (author a module, `CreateAction`, Onyx I/O schemas,
consent per self-configuration.md) is registration ceremony for what is often a throwaway 15-line orchestration snippet.

**`run_code`** is a builtin whose input is a JavaScript module source, executed as an **anonymous inline workflow**:

- Same engine, minus the row: the source runs in orchestration.md's QuickJS workflow sandbox with the full `ctx`
  surface, a `runs` row of kind `workflow`, and the source embedded in `input_cbor` — the anonymous-inline-agent
  precedent from orchestration.md §3 (spec in `input_cbor`, no registry row created), applied to workflows. Journal,
  budgets, cancellation, and observability all reuse §2 of that doc unchanged.
- **`ctx.call` is scoped to the calling session's currently-loaded actions** (the `actions_loaded` set, at their pinned
  CIDs) and evaluated through the same capability gates and the same budget pool as the calling agent's run — code-mode
  grants zero authority the chat turn didn't already have.
- Input/output schemas default to open shapes (`{input?: json} → {result: json}`); intermediate data lives entirely
  inside the sandbox, and only the returned result enters model context.
- A snippet that earns keeping is promoted by registering it: `run_code` source → `CreateAction` workflow record — the
  upgrade path from throwaway to named, versioned, consent-reviewed action.

`run_code` lands once orchestration.md's workflow engine exists (it is a thin wrapper over it), and is discoverable
rather than core so its schema costs nothing until wanted.

## (d) Lambdas

### Definition flow

A lambda is created conversationally (`config.create_lambda`, gated by `config.lambdas.write` per
[self-configuration.md](./self-configuration.md)) or via desktop UI. The flow: author code (a module exposing a single
entry function) → store the module blob to IPFS → `CreateAction` with the lambda record (code link, runtime,
input/output Onyx schemas, summary/description) → the service validates the record against `seed-action-lambda`,
dry-loads the module in the sandbox (syntax check), measures `prompt_tokens`, and inserts the row as **`draft`** —
runnable by its author, invisible to discovery (§b status lifecycle). The authoring agent is expected to test-call it
immediately (`config.test_lambda`); the first successful validated call can be recorded on the version (`verified_at`)
and surfaced in search. `config.publish_lambda` (gated `config.lambdas.publish`, default `ask`) flips it `active` — the
registered, discoverable state — matching self-configuration.md's Flow 2 exactly.

**Runtimes: Python-first.** The deployed sandbox infrastructure supports exactly `python | shell` with a single OCI
image (`CodeExecLanguage` and `config.image` in `agents/src/code-exec.ts`); no JS runtime exists in it today. v1 lambdas
therefore ship on the **Python** runner. The JavaScript runtime is real infrastructure work, not a flag: a node-capable
OCI image, per-runtime image configuration (the config's single `image: string` becomes a per-runtime map), a JS runner
script, and a per-runtime warm pool — scoped explicitly into migration phase 5. The record schema keeps both values in
its `runtime` enum so JS lambdas need no schema change when the image lands.

```py
# module contract (python runtime — v1)
def run(input):  # dict, already validated against the `input` schema
    # No ambient authority: no registry access, no signing keys, no secrets.
    # Network + agent-memory mount per `limits` and service policy.
    return output  # validated against the `output` schema
```

```js
// module contract (javascript runtime — lands with the node image)
export default async function run(input) {
  return output
}
```

### Sandboxed execution

Lambdas run in the existing microVM infrastructure (`agents/src/code-exec.ts`: microsandbox microVMs, 1 CPU / 512 MiB /
60 s defaults, availability probe). Differences from `execute_code`:

- **Input/output cross the boundary as files on a per-call scratch mount** — not stdio framing, and not argv. The
  microsandbox exec surface is `execWith(cmd, args)` with captured stdout/stderr only: no stdin, no extra file
  descriptors (`code-exec.ts` `SandboxLike`; today `execute_code` embeds code in argv as `python -c <code>`, which is
  size-limited and unusable for structured input). The runner contract instead: every lambda VM boots with a dedicated
  empty host directory bind-mounted at `/io`; at call time the host writes the validated input to `/io/input.json` (bind
  mounts are live — host writes are guest-visible after boot), invokes the runner (`python /runner.py <module>`), and
  reads `/io/result.json` — `{ok, output}` or `{ok: false, error}` — after exit. Program stdout/stderr are **logs
  only**, never parsed; the existing 64 KiB per-stream cap keeps bounding them without silently truncating structured
  results, which get their own explicit limit on `result.json` (default 5 MiB, clamped by service policy).
- **Validation at both edges, outside the VM**: `validate(input schema, args)` before boot (fail fast, no VM cost);
  `validate(output schema, result)` after. A lambda whose output fails validation returns a structured error naming the
  lambda at fault — distinct from bad input (see §validation).
- **Warm pool is required, not optional — and it serves mountless lambdas only.** Today every `execute_code` call pays
  full microVM boot; acceptable for an escape hatch, fatal for lambdas that become the _common_ path (a workflow fanning
  out 20 lambda calls per orchestration.md). The service keeps N pre-booted VMs per runtime image, each with its private
  `/io` scratch mount, claims one per call (write input → exec → read result), and destroys it after — never reused
  across calls. The constraint that shapes this: volumes are configured on the `SandboxBuilder` **before** `create()`
  (`code-exec.ts:340-372`), so a pre-booted VM cannot later attach an agent-memory mount. A lambda that opts into the
  memory mount therefore **forfeits the pool and boots cold** — an accepted cost while memory-mounted lambdas are the
  minority; if that assumption fails, the fallback is a copy-in/copy-out emulation over the scratch mount, which changes
  semantics (snapshot, not live) and is deliberately not designed here. The `feat/agent-code-exec` branch's warm
  pool/queue work is the starting point.
- Memory mount and network default **off** for lambdas (opt-in via `limits` + policy), inverting `execute_code`'s
  network-on default — a named reusable action deserves least privilege because it outlives the conversation that
  created it.

### Versioning and audit

Editing a lambda is `UpdateAction`: new record, new CID, old CID archived in `action_versions`. Execution journals
(orchestration.md's run records) store the **CID** called, so history is exact: "which code produced this output" is
always answerable, and a resumed workflow replays the same bytes. Signed protocol actions give every
create/update/import an authenticated author; published lambdas carry their author's signature via the normal Hypermedia
document signing chain.

## (e) Migration from the current registry

The four-plus touch points today: (1) `seedToolRegistry` entry + `SeedToolRegistry` type key
(`agents/protocol/src/tool-registry.ts`), (2) `createAgentServicePiTools()` unconditional construction
(`api-service.ts:3688`), (3) the hardcoded `||` name-filter chain (`api-service.ts:1670-1686`), (4)
`#agentSystemPrompt`'s tool-group lists. Phased path:

1. **Schema conversion (mechanical).** The hand-rolled `JsonSchema` maps near-1:1 to Onyx (`object→map`, `array→list`,
   `additionalProperties:false` is Onyx's default; `number→float`, `enum` carries over). Write `jsonSchemaToOnyx()` + a
   snapshot test asserting every current registry entry converts and validates against `seed-action-builtin`. Aliases
   from `normalizeSeedToolName` become an `aliases` field on the record so legacy agent definitions keep resolving.
2. **Executor binding.** Replace `createAgentServicePiTools()`'s monolith with `registerBuiltin(def, execute)` calls;
   replace the name-filter chain with a registry lookup (`selectors → rows → pi tools`); generate prompt tool-groups
   from `tags`. This deletes touch points 2-4 while behavior is bit-identical (all tools still statically loaded).
3. **Registry rows + protocol + the MCP bridge.** Land the `actions` tables, boot-time builtin upsert,
   `ListActions`/`GetAction`; desktop's render pipeline switches from importing `seedToolRegistry` to querying
   `ListActions` **with the bundled registry as offline/fallback snapshot** — render metadata keeps working throughout
   because the record's `render` block is the same shape. `outputSchema` goes live: outputs validated, failures logged
   (telemetry first, enforcement after the noisy builtins are fixed). The MCP bridge (§f, tools + resources) lands in
   this phase: it is the cheapest way to make the registry immediately useful beyond our own builtins, and it
   stress-tests `jsonSchemaToOnyx()` against real-world schemas before lambdas depend on it.
4. **Discovery.** Ship `action_search`/`load_actions` + the `actions_loaded` event + Pi `setActiveToolsByName` wiring
   with the same-user-turn activation contract (§c); flip the default from "all enabled tools loaded" to "core +
   discovery" per agent (feature-flagged per agent so existing agents are unaffected until opted in).
5. **Lambdas + publishing + skills.** Python-first lambdas with the warm pool; the JS runtime as explicit infrastructure
   work (node-capable image, per-runtime image config, JS runner, per-runtime pool); `run_code` as soon as
   orchestration.md's workflow engine exists; skill records + bundle import (§h). Then **`write` decomposition**: the
   22-command router splits into individual actions (`document_create`, `comment_create`, …) that discovery makes
   affordable — the router survives as an alias facade until agents migrate.

## (f) MCP posture

Pi 0.70.2 has no MCP support, and we should **not block on Pi growing it**: the action registry is a superset of what an
MCP client integration needs. MCP is also the de facto tool ecosystem — thousands of servers, first-class in every
shipped harness — so a "best agent harness" whose registry holds only its own builtins on day one launches behind
everyone. Posture:

- **Bridge, don't embed.** An MCP server is configured per account (like `model_providers`); the Bun service speaks MCP
  client protocol directly and **imports each MCP tool as a builtin-kind action** with `origin: 'mcp://<server>/<tool>'`
  and a proxy executor. The four-kind union stays closed; MCP is a registry _source_, not a fifth kind. Bridged tools
  are searchable/loadable like everything else and get default generic render.
- **Schema conversion is lossy-tolerant.** MCP tool input schemas are JSON Schema; convert via `jsonSchemaToOnyx()` with
  a defined fallback — constructs Onyx can't express (e.g. `patternProperties`, exotic `format`s) degrade to an open map
  with the original schema preserved verbatim in the record for the model-facing definition. Validation then runs at
  whatever fidelity survived; the bridge never blocks a call on a degraded schema.
- **Lands with registry phase 3, not after lambdas** (§e). v1 bridge scope is **tools + resources**: MCP resources
  import as read-only context actions (a `read`-shaped builtin per resource root, summaries from the resource
  descriptions). MCP **elicitation** (server-initiated user input) routes through the existing consent-card surface —
  `consent_requests` + the consent UI from [self-configuration.md](./self-configuration.md) map onto it directly — but
  is scoped after v1, with prompts and sampling; the doc names them so the eventual bridge is knowingly partial, not
  accidentally so. If Pi later ships MCP, we still prefer our bridge — it keeps discovery, prompt-cost accounting, and
  audit uniform.
- **Bridged rows auto-resync** (resolving former open question 8): when a configured server's tool list changes, the
  bridge updates the bridged rows automatically and surfaces a diff notice — the user already trusts the configured
  server, matching how other harnesses treat MCP tool lists. This is deliberately looser than the "imports never
  auto-update" rule, which continues to govern hm://-published imports where the trust object is a specific reviewed
  version, not a live server.

## (g) Validation plumbing

- **ipld↔dag-json converter** (the ~20-line gap named in the analysis): the Onyx engine validates dag-json-shaped
  values (`{"/": cid}` links, `{"/":{"bytes":…}}` bytes). Two directions: `ipldToDagJson()` for decoded-CBOR values (CID
  objects, Uint8Array) before validating stored records; model-emitted tool args are already plain JSON and pass through
  untouched. Lives beside the engine consumers in the agents service (`agents/src/actions/onyx.ts`), importing
  `onyx-engine.ts` (dependency-free, one generated-bundle import; committed on `feat/onyx` and verified React-free).
  **Caveat on the rest of the Onyx toolchain**: the CLI's async resolvers (`resolveSchemaRef`/`effectiveDocSchema` in
  `frontend/apps/cli/src/utils/onyx.ts`) and the `schemas/` reference validator + fixtures are today **uncommitted
  working-tree files on one machine — not on `feat/onyx` or any branch**. Committing them (or copying them into the
  design branch) is a hard prerequisite for any phase that reuses them; until then this doc cites them as prototypes,
  not reusable code.
- **Union errors need help.** The meta-schema has no declared discriminator — union membership is the single-value-enum
  convention (§a sketch note) — so a value failing a union validates as a per-variant error list. `parseOnyxError`
  applies the tag convention as a heuristic (match the candidate variant by its enum-tagged property first, report that
  variant's errors, demote the rest) so the model gets one variant's field-level pointers instead of N variants' noise.
  The error-quality claims below assume this heuristic exists.
- **Structured errors for retry.** `validate()` returns `string[]` paths-with-messages; `parseOnyxError()` structures
  each into `{path, rule, message}`. Input-validation failure short-circuits before execution and returns a tool error:

```json
{
  "error": "input_validation",
  "action": "acme/summarize-pr",
  "issues": [{"path": "input.prUrl", "rule": "required", "message": "missing required property"}],
  "hint": "Fix the listed fields and call again. The input schema is unchanged."
}
```

Pi's normal tool-error path returns this to the model, which retries with corrected args — the standard agentic
self-repair loop, now with field-level pointers instead of a stack trace.

- **Output-failure semantics differ by kind.** Builtin output failure = _our_ bug: log + telemetry, deliver the output
  anyway (never punish the model for service bugs). Lambda/workflow output failure = the action's bug: return an
  `output_validation` error to the model, which can fix the lambda (if it authored it) or report it; the failure is
  recorded against the action version.
- **Resolution memoization.** `resolveSchema`/ref-resolution results are memoized by CID (immutable ⇒ cache-forever) and
  by hm:// name with invalidation on `actions-changed`/registry writes — validation sits on the per-call hot path.
- Validation is validate-only (never coerces) per the Onyx contract, so what the journal records is exactly what the
  model sent and the executor returned.

## (h) Skills and bundles

Progressive discovery as designed above covers tool _schemas_; it does nothing for procedural knowledge. The
highest-leverage recent primitive in shipped harnesses is the **skill**: a procedure whose one-line description is
always in context and whose body loads on demand — progressive disclosure of _instructions_, not just definitions.
Without this tier every multi-step "how we do X here" must either burn into a system prompt or over-formalize into a
deterministic workflow, with nothing in between. And Seed is uniquely positioned here: a skill is naturally a signed
hypermedia document — content-addressed versions, author identity, network publishing, import-with-consent — exactly the
machinery this doc already builds for actions.

A **skill is registry data, not a callable** — the four-kind action union stays closed:

```
seed-skill: {name, summary (≤120 chars), body (markdown), resources?: [link]}
```

- **Same storage, same search.** Skill rows live in the `actions` table (the `kind` CHECK gains `'skill'`; the executor
  refuses to dispatch skill rows) and index into the same `actions_fts`, so `action_search` returns skills alongside
  actions, distinguished by `kind` in results.
- **Loading reuses `load_actions`.** A skill ref activates by injecting `body` as a system-role block instead of
  constructing a `ToolDefinition`; the same `actions_loaded` event records it (ref + pinned CID), so durability, replay,
  and version pinning work identically, and the body's token cost counts against the same prompt budget as loaded tool
  definitions.
- **Publish/import reuse `PublishAction`/`ImportAction` verbatim.** A skill body enters model context, so it is a
  prompt-injection surface exactly like imported descriptions (see security): imports are consent events, and the CID
  pins what was reviewed to what is injected.
- **Bundles** are the Seed answer to plugins: a `seed-bundle` hypermedia document listing agents + actions + skills +
  triggers as pinned refs, installed as one consent that fans out through the ordinary import paths (triggers and agents
  born `draft` per self-configuration.md, so activation review is preserved). Sketch only; the bundle shape is an open
  question.

## (i) Cross-account agent requests (design placeholder)

Everything in this doc family is account-scoped: agents call actions within one account on one server. The industry is
racing at inter-agent protocols precisely because identity, provenance, and consent are the hard parts — and Seed
already owns all three (Ed25519 identities, signed envelopes, content-addressed payloads, network sync). This doc
publishes action _definitions_ to the network, and the existing user-mention trigger is already a primitive inter-agent
channel — but untyped, unacknowledged, and undesigned. Nothing here is scheduled; the placeholder exists so the four
docs don't bake in single-account assumptions that would make federation a rewrite:

- **`agent.request`**: a signed, Onyx-typed request document addressed to a target account's _published_ agent,
  delivered over existing sync, landing in the receiver's inbox/consent surface
  ([context-and-threads.md](./context-and-threads.md)'s attention states fit exactly). The response is a signed reply
  document linked to the request CID.
- Runs originated this way carry an **`external` origin — the strictest taint tier** for
  [self-configuration.md](./self-configuration.md)'s origin-downgrade rule; the run/consent origin enums must reserve
  the value.
- Design discipline this imposes today: run provenance stays expressible as **portable signed objects** (CIDs, signed
  envelopes, `hm://` refs) rather than local rowids — already true of the record design in this doc.

## Security considerations

- **Execution pins CIDs.** Discovery and configuration use mutable `hm://` names; the moment an action is loaded into a
  session, its CID is recorded (`actions_loaded` event) and that exact version executes for the session's remainder. No
  TOCTOU between "user approved this lambda" and "this code ran".
- **Imports are installs.** Importing a lambda/workflow from the network requires explicit user consent showing author
  identity, code size, requested limits, and the diff on upgrade. Imported executable code never runs outside the
  microVM; `limits` in the record are requests clamped by service policy, not grants.
- **No ambient authority in lambdas.** No signing keys, no secrets, no registry/protocol access inside the VM; network
  and memory-mount are opt-in per action and per policy. Lambdas that need signed writes must go through an agent- or
  workflow-kind action where the permission model ([self-configuration.md](./self-configuration.md)) applies.
- **Untrusted text stays inert.** Imported action `summary`/`description` — and imported skill `body` text (§h) — enter
  the model's context: a prompt-injection surface. Mitigations: consent screens render them as quoted untrusted content;
  search results cap summary length; a published action's description (and a skill's body) is part of its CID, so what
  was reviewed is what is injected.
- **`run_code` adds no new authority.** Ephemeral orchestration code runs in the same zero-ambient-authority QuickJS
  realm as registered workflows; every effect crosses `ctx.call`, which is scoped to the session's loaded actions,
  capability-gated, budget-metered, and journaled. The only delta from a registered workflow is the absent registry row
  — the audit trail (run row + journal + embedded source in `input_cbor`) is identical.
- **Render metadata is display-only** — labels and JSON paths, never code; `customViews` resolve only against
  desktop-shipped view implementations keyed by name.
- **Onyx validation is a correctness tool, not a security boundary.** The sandbox is the boundary; validation failure
  handling must not assume malice-free inputs (e.g. error messages truncate echoed values).
- Name-squatting on `hm://` action names is scoped by account identity — a ref always includes the authority; the UI
  shows the author account, never a bare name.

## Testing strategy

- **Conversion snapshot suite**: every current `seedToolRegistry` entry → Onyx → validates against
  `seed-action-builtin`; the converted schemas' JSON-Schema _projection_ round-trips to accept exactly the inputs the
  old schema accepted (property-test on generated instances).
- **Engine parity**: the agents service's engine copy stays behaviorally identical to the reference validator — reuse
  the oracle-parity tests against the `schemas/validate.mjs` fixtures **once those are committed** (today they are
  uncommitted working-tree files, §g caveat; committing them is a prerequisite for this suite).
- **Registry CRUD + versioning**: create/update/import/status transitions; CID stability across encode/decode; boot-time
  builtin upsert produces version bumps only on real definition changes.
- **Discovery e2e**: session searches → loads → **calls the loaded action within the same user turn** (the pinned
  activation contract in §c — the assertion must fail if activation slips to the next user message); kill/resume mid-run
  and assert the `actions_loaded` replay restores the identical active set and CIDs (deterministic-resume contract);
  replay across a compaction boundary keeps the loaded set; `load_actions` on an unknown ref returns a structured error,
  and on a same-run-created ref either succeeds via registry rebuild or returns the available-next-run error — never a
  silent drop.
- **Validation paths**: input failure returns structured error and the model-retry loop closes (scripted Pi fake);
  builtin vs lambda output-failure semantics; converter fuzz (CID/bytes round-trips).
- **Lambda sandbox**: `code-exec.ts` already supports an injected fake SDK — extend it to cover the runner protocol
  (`/io` file framing, result-size limit, log-stream cap, timeout, limits clamping, cold-boot path for memory-mounted
  lambdas vs pooled path for mountless ones); one real-microVM smoke test gated on availability probe.
- **Prompt-budget regression**: measured core-set token cost asserted under a ceiling in CI so tool-prompt creep is
  caught the way bundle-size creep is.

## Open questions

1. **Publishing authority**: do `seed-action-*` schemas publish under the existing Onyx account (`z6MkmZUb…`) alongside
   the standard library, or under a separate Seed-agents authority? (Affects the `hm://<seed>` placeholder throughout.)
2. **Shared-core dedup**: can the meta-schema's `include` variant express the shared callable core across the four
   variants, or do we accept field repetition (as `hypermedia-op-*` variants do today)?
3. **Inline vs published I/O schemas**: should `CreateAction` auto-publish inline input/output schemas as schema docs
   (so they get URLs and reuse), or stay inline until explicitly published?
4. **JS lambda timing**: v1 is Python-first (resolved in §d — Python is the runtime the deployed sandbox actually has).
   Does the node runtime (image, per-runtime config, runner, pool) land inside phase 5 as scoped, or defer until demand,
   with `run_code` (QuickJS orchestration) + Python lambdas covering the interim?
5. **Config injection**: per-selector `config` (agent-pinned action configuration) — does it merge into `input` under a
   reserved key, bind as a second executor argument, or partially-apply the input schema? Interacts with
   content-addressing (config is per-agent, not part of the action CID).
6. **Budget behavior at the edge**: when `load_actions` would exceed the prompt budget, hard-refuse (force explicit
   `unload`) vs auto-evict least-recently-used loaded actions? Auto-evict is friendlier but makes the active set less
   predictable for resume.
7. **`memory` collapse vs family**: collapsing five memory tools into one router saves prompt cost but recreates the
   `write`-style mega-schema at small scale — is a 5-command union acceptable in core, or should core carry
   `memory_read`+`memory_list` only and defer writes to discovery?
8. **Bundle shape** (§h): what a `seed-bundle` doc pins per component (mutable `hm://` refs vs CIDs), and how bundle
   upgrades interact with the "imports never auto-update" rule — one re-consent for the whole bundle, or per component?
9. **`run_code` surface** (§c): discoverable-only (current lean) or core for agents that orchestrate heavily? And should
   the promotion path ("save this as a workflow") pre-fill `CreateAction` from the last `run_code` invocation's
   journaled source + observed I/O?
10. **Cross-account transport** (§i): delivery/ack semantics for `agent.request` (pure sync vs relay), and where the
    consent surface lives when the receiving account's agents run on a headless server.

(Former question 8 — MCP bridge lifecycle — is resolved in §f: bridged rows auto-resync with a diff notice; the
never-auto-update rule stays scoped to hm:// imports. Former question 4 — the lambda runner contract's home language —
is resolved in §d: Python-first.)
