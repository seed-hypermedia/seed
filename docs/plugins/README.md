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
| [`authoring.md`](./authoring.md) | **How to write a plugin** — SDK, schemas, manifest, publishing, debugging |
| [`design.md`](./design.md) | Architecture: manifest format, sandbox, bridge protocol, permissions, agent-tool merge |
| [`plan.md`](./plan.md) | Implementation phases and live status |

## Trying it

Settings → Plugins (desktop). Install by pasting a plugin manifest
`ipfs://` URL — the manager previews the manifest, its permissions, and its
actions before you confirm. Enabled plugins expose per-action **Run**
buttons: the input form is auto-generated from the action's input schema
(literal-union dropdowns, HM references, links — the full schema-driven
editor), execution happens in the sandbox, and the output is validated
against the output schema and rendered as structured data.

### The example plugin

[`example-plugin.json`](./example-plugin.json) contains a complete
deterministic plugin (slugify: text → URL slug; zero permissions). Publish
its blobs to your local daemon (gRPC port from your running app):

```sh
python3 -c "import json; d=json.load(open('docs/plugins/example-plugin.json')); print(json.dumps({'blobs':[{'cid':b['cid'],'data':b['data']} for b in d['blobs']]}))"   | grpcurl -plaintext -d @ localhost:58002 com.seed.daemon.v1alpha.Daemon/StoreBlobs
```

then install `ipfs://bafyreifgwbw4eeadsm4anb3hz54fyxh7klrq4pdzf2aenbvttal6a2ntda`.

A second example, [`example-find-replace.json`](./example-find-replace.json)
(install `ipfs://bafyreidyf666rpikc7dskkwihuvzjiskphqnzhtyyopojliuil2ulk2mz4`),
exercises the document capabilities: give it a document URL (HM Url field with
search), a find string, and a replace string — it rewrites the open document's
metadata and **stages the change into the draft** (nothing publishes; you
review and publish). Run it from the document's options menu (Developer Mode)
so the document capabilities are live.

## Status

**Phases 1–3 implemented** (see [`plan.md`](./plan.md)): manifest core +
LLM schema compiler, the worker-in-iframe sandbox with permission-gated
bridge, and the plugin manager with schema-driven invocation. Next: the
main-process hardening patches and the Phase-A agent-tool merge.
