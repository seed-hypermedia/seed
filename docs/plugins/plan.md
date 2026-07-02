# Implementation plan & status

Status values: `todo` / `in progress` / `review` / `done`.

## Phase 1 — Pure core — `in progress`

- [ ] `plugin-manifest.ts`: manifest + action types, permission vocabulary,
      `validatePluginManifest` (advisory-style, precise errors),
      `PLUGIN_MANIFEST_SCHEMA` blob + pinned CID (drift-checked by test),
      `pluginToolName`/`parsePluginToolName` (`plugin_<name>__<action>`)
- [ ] `blob-schema-compile.ts`: blob dialect → plain JSON Schema subset for
      LLM-facing tool inputs (inline internal+registry refs, lower kinds/
      formats/literal unions/unions, strip unknown keywords), with tests
- [ ] Tests for both modules

## Phase 2 — Sandbox host (desktop) — `todo`

- [ ] `plugin-shim.ts`: static srcdoc bootstrap (CSP, worker-per-invocation,
      MessageChannel protocol, `seed.action`/`seed.call` SDK)
- [ ] `plugin-host.tsx`: iframe lifecycle, handshake, invocation with
      deadline + terminate, bridge routing
- [ ] `plugin-bridge.ts`: permission-checked `document.read`,
      `document.updateMetadata`, `blob.get`, `blob.publish`
- [ ] Main-process hardening: `will-frame-navigate` srcdoc hard-deny +
      hostname allowlist fix; webRequest frame filter; deny-by-default
      permission handler

## Phase 3 — Install & invoke UX — `todo`

- [ ] `plugin-store.ts` trpc router + app-store persistence (installed CIDs,
      enabled flag)
- [ ] `models/plugins.ts`: installed manifests via `useSchemaRegistries`-style
      fetching
- [ ] Plugin manager UI (behind Developer Mode): install by `ipfs://` URL,
      shows title/description/permissions/actions, enable/disable
- [ ] Run-action dialog: schema-driven input form → run → output view with
      advisory output validation

## Phase 4 — Agent merge (desktop assistant) — `todo`

- [ ] `DynamicToolDescriptor` + per-request `chatTools` builder in
      `app-chat.ts` appending enabled plugin actions
- [ ] Main ↔ renderer host IPC for tool execution
- [ ] Compiled input schemas for the model; original CIDs kept for forms

## Phase 5 — Hosted agent-service (designed, deferred)

`clientTools` on MessageSession, `tool_request` WS event + `SubmitToolResult`
signed action, headless-session exclusion. See design §5 Phase B.
