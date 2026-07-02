# Implementation plan & status

Status values: `todo` / `in progress` / `review` / `done`.

## Phase 1 — Pure core — `done`

- [x] `plugin-manifest.ts` (pinned schema CID
      `bafyreihqfltqulazz4erxr37nel6exe34fknmyrb26fixzzsimuhdwdqta`)
- [x] `blob-schema-compile.ts` — dialect → plain JSON Schema lowering
- [x] 48 tests across both modules

## Phase 2 — Sandbox host (desktop) — `done`

- [x] `plugin-shim.ts` — static srcdoc, network-closing CSP, worker per call
- [x] `plugin-host.ts` — lifecycle, deadlines + terminate, permission gate
- [x] `plugin-bridge.ts` — four capabilities, injected, size caps
- [x] 9 protocol-level tests (jsdom cannot execute srcdoc/workers — the
      sandbox itself needs a manual/E2E pass in the real app)
- [x] Main-process hardening: `will-frame-navigate` hard-denies srcdoc
      frames (no shell.openExternal) and the embed allowlist is hostname-
      matched (was substring); webRequest cancels http(s) requests from
      srcdoc frames (defense-in-depth behind the CSP for the open-CORS
      daemon port); permission requests granted only to the app origin

## Phase 3 — Install & invoke UX — `done`

- [x] `app-plugins.ts` trpc router + app-store persistence
- [x] `models/plugins.ts`: records + validated manifests + code fetching
- [x] Settings → Plugins tab: install-by-URL with manifest/permission
      preview, enable/disable, uninstall
- [x] Run-action panel: schema-driven input form (instantiated starter),
      sandboxed run, output with advisory validation
- [x] Example plugin fixture (`example-plugin.json`, slugify, deterministic
      CIDs) + publish instructions in README

## Phase 4 — Agent merge (desktop assistant) — `todo`

- [ ] `DynamicToolDescriptor` + per-request `chatTools` builder in
      `app-chat.ts` appending enabled plugin actions
- [ ] Main ↔ renderer host IPC for tool execution
- [ ] Compiled input schemas for the model; original CIDs kept for forms

## Phase 5 — Hosted agent-service (designed, deferred)

`clientTools` on MessageSession, `tool_request` WS event + `SubmitToolResult`
signed action, headless-session exclusion. See design §5 Phase B.
