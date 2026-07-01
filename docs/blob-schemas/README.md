# Blob Schemas — editable JSON Schemas for DAG-CBOR blobs

This directory documents the **blob schemas** project: giving raw DAG-CBOR IPFS blobs
editable, content-addressed schemas built on JSON Schema, extended for the IPLD data
model (native links and bytes).

Builds directly on the raw blob editor work — read
[`../metadata-and-blob-editor.md`](../metadata-and-blob-editor.md) first for that
foundation (value editor, `raw-blob` route, publish path, `.dagjson` daemon endpoint).

## Goals

1. **Schema editor** — a dedicated GUI for authoring JSON Schemas (our extended
   dialect), published as ordinary DAG-CBOR blobs with `ipfs://CID` URLs.
2. **Extended dialect** — JSON Schema plus first-class IPLD kinds: **bytes** and
   **links** (CIDs). Schemas can link to other schemas by `ipfs://` ref.
3. **Schema-attached blobs** — the blob editor lets you paste a schema `ipfs://` URL;
   the blob then carries a `schema` field that is a real IPLD link to the schema blob.
4. **Schema-aware editing** — with a schema attached, the value editor constrains and
   assists: field types come from the schema, required fields are surfaced, enums
   become selects, links/bytes fields get the right inputs.
5. **Gentle validation** — data that violates its schema is *warned about, never
   blocked or destroyed*. The user can always keep, edit, or export invalid data.
6. **New instance from schema** — the schema editor has a "create instance" action
   that opens the blob editor pre-shaped by the schema, with `schema` already linked.
7. **Solid IPFS links everywhere** — blob→schema, schema→schema (`$ref`), blob→blob.
   Content addressing means schemas are immutable; "editing" a schema publishes a new
   CID (instances keep pointing at the exact schema version they were written against).

## Documents

| Doc | Contents |
| --- | --- |
| [`workflow.md`](./workflow.md) | How this project is being executed: agent/workflow setup, phases, commit strategy |
| [`architecture.md`](./architecture.md) | System design: modules, data flow, where each piece lives |
| [`schema-dialect.md`](./schema-dialect.md) | The extended JSON Schema dialect: supported keywords, IPLD kinds, `$ref` over ipfs://, examples |
| [`plan.md`](./plan.md) | Implementation plan: phases, tasks, status (kept current as work proceeds) |

## Status

**Phase: research.** A multi-agent research workflow is mapping the value editor
internals, publish path, routing, validation ecosystem, and prior art. Architecture
and dialect docs land when it completes.
