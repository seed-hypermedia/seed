# Seed Plugins

Sandboxed, content-addressed plugins for the Seed desktop app. This directory
is the live documentation for the `feat/plugins` project.

Builds directly on [blob schemas](../blob-schemas/README.md): plugin manifests
and action input/output schemas are ordinary DAG-CBOR blobs with `ipfs://`
CIDs, edited and validated by the same machinery.

## Goals (owner's brief)

1. **Headless iframe per plugin** — plugin code runs in a sandboxed iframe
   with no DOM surface of its own; all capability flows through a postMessage
   bridge. Safety first: a plugin can do nothing it wasn't granted.
2. **Actions with content-addressed schemas** — a plugin exposes *actions*
   (tools). Each action declares an **input schema** and an **output schema**,
   both stored as IPFS blobs in the Seed Blob Schema dialect.
3. **Auto-generated forms** — when a user invokes an action, the app renders
   the input form from the action's input schema using the schema-driven value
   editor (dropdowns for literal unions, HM references with search, links,
   bytes, …). Output is rendered/validated against the output schema.
4. **Declared permissions** — the manifest declares needs (e.g. *read current
   document*, *write current document*, *network*). The host enforces them at
   the bridge; nothing is ambient.
5. **One tool surface** — plugin actions merge into the existing agent tool
   infrastructure, so agents can discover and call plugin actions like any
   other tool.
6. **Agents write plugins** — the plugin format is simple, self-contained, and
   text-first so an agent can author, publish, and iterate on plugins.

## Documents

| Doc | Contents |
| --- | --- |
| [`design.md`](./design.md) | Architecture: manifest format, sandbox, bridge protocol, permissions, agent-tool merge |
| [`plan.md`](./plan.md) | Implementation phases and live status |

## Status

**Phase: research.** Parallel readers are mapping the agents server's tool
registry (the merge target), the desktop integration surfaces, and the
Electron sandboxing constraints. The design doc lands when they report.
