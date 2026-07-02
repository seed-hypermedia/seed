# Plugin system design

Synthesized from parallel research over the agents server (`agents/`), the
desktop integration surfaces, and the Electron security posture. File/line
references are to `feat/plugins` at the time of writing.

## 1. A plugin is a set of content-addressed blobs

Everything about a plugin lives in IPFS, in formats we already have:

```
input schema blob(s)     Seed Blob Schema dialect (docs/blob-schemas/)
output schema blob(s)    Seed Blob Schema dialect
code blob                raw-codec blob: one self-contained JS file (ES2020, no imports)
manifest blob            DAG-CBOR, conforming to the published plugin-manifest schema
```

The manifest (DAG-JSON face):

```json
{
  "schema": { "/": "<pluginManifestSchemaCid>" },
  "name": "word-count",
  "title": "Word Count",
  "description": "Counts words in the current document.",
  "version": "1.0.0",
  "permissions": ["document:read"],
  "code": { "/": "<rawJsBlobCid>" },
  "actions": [
    {
      "name": "count_words",
      "title": "Count Words",
      "description": "Counts the words in the current document, by section.",
      "input": { "/": "<inputSchemaCid>" },
      "output": { "/": "<outputSchemaCid>" }
    }
  ]
}
```

- **Plugin identity = manifest CID.** Installing a plugin = storing its CID
  (and granted permissions) in the app store; the blobs pin locally via the
  standard fetch path. Upgrading = installing a new CID.
- The manifest schema is itself a published blob schema (`schema` links it),
  so the schema editor can author manifests and the metadata/blob editors
  validate them — the same dogfooding as the meta-schema.
- **Agents author plugins** by publishing 3+ blobs (schemas, code, manifest)
  through the existing `PublishBlobs` path — all text-first, no packaging
  step. A single-file plugin needs no build tooling at all.

## 2. Sandbox: worker-in-iframe, headless

Per plugin, the host creates a hidden iframe that can do *nothing* but run
script and talk to us:

```
<iframe sandbox="allow-scripts" style="display:none" srcdoc={SHIM_HTML}>
```

- **No `allow-same-origin`** → opaque origin: no cookies, no storage, no app
  origin access. No `allow-popups` / `allow-top-navigation` / forms / modals.
- `SHIM_HTML` is a **static trusted bootstrap** (our code, no plugin content
  interpolated — avoids HTML-injection) with a meta CSP:
  `default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:;
  connect-src 'none'; base-uri 'none'; form-action 'none'`.
  `connect-src 'none'` kills fetch/XHR/WebSocket **including inside workers**
  (blob workers inherit the document CSP) — critical because the Go daemon's
  HTTP port has deliberately open CORS (`backend/daemon/http.go:248`) that a
  networked frame could reach.
- **Plugin code runs in a Worker** created from a Blob URL inside the iframe,
  one fresh Worker **per invocation**: stateless, leak-free, and
  `worker.terminate()` is a synchronous unrefusable kill for runaway plugins
  (a bare-iframe infinite loop would freeze the window; a worker only burns
  its own thread until the deadline fires).
- **Code delivery**: the trusted side fetches the code blob by CID (hash
  verified by the daemon), and `postMessage`s `{code}` to the shim. The
  sandbox never fetches anything itself.
- **RPC**: a `MessageChannel` per invocation (ports are unforgeable;
  raw postMessage to an opaque origin would force `targetOrigin: '*'`).
  JSON-RPC-shaped, structured-clone payloads:
  - host → plugin: `{id, method: 'invoke', action, input}`
  - plugin → host: `{id, result}` / `{id, error: {message}}`
  - plugin → host capability calls: `{id, method: 'seed.<api>', params}` —
    answered only if the manifest declares the permission (§4).
- **Plugin-side SDK** (defined by the shim, tiny and agent-memorable):

  ```js
  seed.action('count_words', async (input) => {
    const doc = await seed.call('document.read', {})
    return {total: countWords(doc)}
  })
  ```

- **Lifecycle**: iframe spawns lazily on first invocation and is reused;
  worker per call with a deadline (default 30s) → `terminate()` → iframe
  removal as escalation. Figma's QuickJS-in-WASM interpreter exists only to
  serve a *synchronous* scene-graph API; our actions are async tools, so
  iframe+worker+async RPC gives equivalent safety with far less machinery.

### Main-process hardening (required before shipping)

Research found three holes a plugin frame could use today
(`apps/desktop/src/app-windows.ts`, `main.ts`):

1. `will-frame-navigate` (app-windows.ts:503) calls `shell.openExternal` for
   non-allowlisted subframe navigations — a plugin self-navigating (allowed by
   sandbox) would pop the user's real browser at an attacker URL. Plugin
   frames (`about:srcdoc`) must be hard-denied with no `openExternal`. The
   `url.includes(domain)` substring allowlist there is also a pre-existing
   bug (`evil.com/?x=youtube.com` passes) — fix to hostname matching.
2. `webRequest.onBeforeRequest`: cancel requests from `about:srcdoc` frames —
   defense-in-depth behind the CSP for the open-CORS daemon port.
3. `session.setPermissionRequestHandler` deny-by-default (currently unset;
   Electron default-grants).

## 3. Invocation: schema-driven forms

Running an action from the UI:

1. Fetch the action's input schema blob (existing `useSchemaRegistries`).
2. Render the form with the schema-driven value editor — `instantiateSchema`
   seeds the starter value, `BlobSchemaProvider` + `ValueEditor` give
   dropdowns for literal unions, HM references with search, links, bytes.
3. Run: host validates input (advisory + size cap), spawns the worker,
   invokes, enforces the deadline.
4. Output is validated against the output schema (advisory warnings, never
   dropped) and rendered with the read-only value display. Plugin output is
   **data, never markup** — it must never reach `innerHTML` or the app
   origin as anything but structured values.

## 4. Permissions

The manifest declares needs from a fixed, versioned vocabulary; the bridge
enforces them per method call. Nothing is ambient — the worker has no
network, no storage, no DOM; every capability is an RPC we can refuse.

| Permission | Bridge methods | v1 semantics |
| --- | --- | --- |
| `document:read` | `document.read` | The *current* document: id, metadata, content blocks |
| `document:write` | `document.updateMetadata` | Stage a metadata patch into the current draft (same staged path as the metadata editor — user still publishes) |
| `blob:read` | `blob.get` | Fetch any IPFS blob by CID via the daemon |
| `blob:write` | `blob.publish` | Publish DAG-CBOR blobs (explicit sha256 CIDs) |

Deferred vocabulary (designed for, not implemented): `network:fetch` with a
host allowlist, `search`, `document:read-any`.

Grant model v1: permissions are displayed at install time and granted by the
act of installing; the plugin manager shows them per plugin and allows
disable. (Per-call prompting and per-permission toggles can layer on without
protocol changes since enforcement is per bridge call.)

Trust note: plugin **descriptions and schemas become model-facing prompt
text** when merged into agent tools, and plugin outputs flow into agent
context — both are prompt-injection channels. Descriptions get length caps;
outputs are labeled as plugin-originated.

## 5. Merging with the agent tool infrastructure

Research mapped the tool stack precisely (see `agents/protocol/src/tool-registry.ts`):
one canonical registry of 8 compile-time tools (`SeedToolMetadata`: name,
description, plain-JSON-Schema `inputSchema`, declarative render metadata),
consumed by **two runtimes** — the desktop local assistant (`app-chat.ts`,
Electron main, Vercel AI SDK, a plain `chatTools` record) and the hosted
agent-service (`agents/src/api-service.ts`, Pi SDK, per-run session
construction with a tool-name allowlist). No MCP, no dynamic registration
anywhere today.

**`DynamicToolDescriptor`** — the serializable bridge type — is
`SeedToolMetadata` minus code: name/label/description/inputSchema/
outputSchema + optional declarative `render`, plus `pluginCid`, `actionName`,
`permissions`, and the original schema blob CIDs. Tool names are namespaced
`plugin_<name>__<action>` so they can never collide with registry names.

**Schema compilation**: the LLM-facing `inputSchema` must be the registry's
plain JSON Schema subset (no `$ref`/`kind`/`format`/`oneOf`). A pure compiler
lowers the blob dialect: external `$ref`s inlined from the registry, `kind:
link` → `{type: 'string', description: 'ipfs:// CID …'}`, `hm-url/profile`
formats → string with description, literal unions → `enum`, unions → lowered
best-effort with description. The desktop form generator keeps consuming the
rich dialect directly — compilation is only for the model.

**Phase A — desktop local assistant (no protocol change):** `chatTools` in
`app-chat.ts:506` becomes a per-request builder that appends enabled plugin
actions; `execute` hops main → plugin host → sandbox and back through the
permission bridge. Rendering already degrades gracefully for unknown tool
names (`assistant-message-rendering.tsx` falls back to generic input/output
bubbles), improving later via a dynamic-metadata source next to
`getSeedToolMetadata`.

**Phase B — hosted agent-service (protocol deltas, designed not built):**
(a) `MessageSession` carries `clientTools: DynamicToolDescriptor[]`; the
per-run Pi session registers them as extra `defineSeedPiTool` entries
(drop-in at `api-service.ts:1166-1186`). (b) Execution round-trips to the
desktop: new WS event `{_: 'tool_request', key, toolCallId, name, input}` +
new signed action `SubmitToolResult {sessionId, toolCallId, output|error}`,
with server-side pending-call timeout → `tool_result.error`. The signed
envelope / account isolation model already gives the right authz boundary
(only the account owner's desktop can answer). Headless trigger-created
sessions must exclude client tools. Durable `tool_call`/`tool_result` events
already accept arbitrary tool names — no event schema change.

## 6. Module layout

```
frontend/packages/ui/src/
  plugin-manifest.ts        ← pure: manifest types, PLUGIN_MANIFEST_SCHEMA (+pinned CID),
                              permission vocabulary, validateManifest, tool naming
  blob-schema-compile.ts    ← pure: blob dialect → plain JSON Schema (LLM-facing)

frontend/apps/desktop/src/plugins/
  plugin-shim.ts            ← the static srcdoc bootstrap (string constant) + its tests' contract
  plugin-host.tsx           ← iframe lifecycle, MessageChannel RPC, deadlines, bridge routing
  plugin-bridge.ts          ← permission-checked implementations of seed.* methods
  plugin-store.ts           ← app-store persistence of installed CIDs + grants (trpc router)
frontend/apps/desktop/src/models/plugins.ts   ← hooks: installed plugins, manifests via registry
frontend/apps/desktop/src/pages/…             ← plugin manager + run-action dialog (developer mode)
```

## 7. Threat model summary

| Threat | Mitigation |
| --- | --- |
| Plugin exfiltrates data over network | CSP `connect-src 'none'` (inherited by workers) + webRequest frame filter |
| Plugin reaches app origin / IPC / tRPC | Opaque origin (no `allow-same-origin`); preload doesn't run in subframes |
| Plugin opens windows / navigates user | sandbox flags + hardened `will-frame-navigate` for `about:srcdoc` |
| Runaway CPU | Worker per invocation + deadline + `terminate()` |
| Memory abuse (OOM of host renderer) | `IsolateSandboxedIframes` flag; escalate to per-plugin hidden WebContentsView if real |
| Malicious capability use | Bridge: per-method permission check, input/output schema validation, size caps |
| Prompt injection via descriptions/outputs | Length caps on model-facing text; outputs labeled plugin-originated; schemas compiled to plain JSON Schema |
| Fake/forged messages | MessageChannel ports (unforgeable), `event.source` verified once at handshake |
