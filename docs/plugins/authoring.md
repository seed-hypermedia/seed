# Writing a Seed plugin

The guide for humans and agents authoring plugins. A plugin is nothing but
blobs — if you can publish four IPFS blobs, you can ship a plugin.

## 1. What you're building

| Blob | Codec | Contents |
| --- | --- | --- |
| Input schema (per action) | dag-cbor | Seed Blob Schema describing the action's input — this **is** the user's form |
| Output schema (per action) | dag-cbor | Seed Blob Schema describing the action's result |
| Code | raw | One self-contained JS file (ES2020, no imports, no top-level await) |
| Manifest | dag-cbor | Ties it together; its CID is the plugin's identity |

Working examples with exact bytes: [`example-plugin.json`](./example-plugin.json)
(slugify — zero permissions) and
[`example-find-replace.json`](./example-find-replace.json) (find & replace —
reads the open document and stages draft changes).

## 2. The code file

Your code runs in a locked-down sandbox: **no network, no DOM, no storage, no
imports**. A fresh worker per invocation — keep handlers stateless. The whole
API is two functions:

```js
// Register one handler per action declared in your manifest.
seed.action('find_replace', async (input) => {
  // input already matches your input schema (the app generated the form
  // from it, and agents are given the compiled schema) — but treat it as
  // untrusted anyway.
  const doc = await seed.call('document.read', {})
  // … compute …
  await seed.call('document.updateMetadata', {patch: {name: 'New title'}})
  return {done: true} // must match your output schema (advisory)
})
```

`seed.call(method, params)` is the capability bridge. Every method needs a
permission your manifest declares — undeclared calls reject with a clear
error, so failures are diagnosable from inside the plugin.

| Method | Permission | Params → result |
| --- | --- | --- |
| `document.read` | `document:read` | `{}` → `{id, metadata}` of the **open** document (draft values win) |
| `document.updateMetadata` | `document:write` | `{patch: {key: value, …}}` → stages into the **draft**; never publishes. `null` value deletes a key. |
| `blob.get` | `blob:read` | `{cid}` → the decoded DAG-CBOR value (DAG-JSON face) |
| `blob.publish` | `blob:write` | `{value}` → `{cid}` (canonical DAG-CBOR, sha2-256) |

Errors: throw inside your handler — the message reaches the user/agent.
Deadline: 30s per invocation (60s when called by the assistant), then a hard
kill. Output cap: 256 KiB when returned to an agent.

## 3. Schemas

Author them in the app (New Schema, behind Developer Mode) or as raw values —
they're ordinary Seed Blob Schemas (see
[`../blob-schemas/schema-dialect.md`](../blob-schemas/schema-dialect.md)).
Everything the schema editor supports works in action forms: literal-union
dropdowns, **HM Url / HM Profile** fields with document/account search, IPLD
links and bytes, unions.

Design the input schema as the form you want users to see: `title` and
`description` become labels and help text; `default`s prefill; `required`
drives chips. The output schema documents your result and drives the advisory
"doesn't match" warnings.

## 4. The manifest

```json
{
  "schema": { "/": "<PLUGIN_MANIFEST_SCHEMA_CID>" },
  "name": "find-replace",
  "title": "Find & Replace",
  "description": "…shown to users AND to models — keep it precise (≤1024 chars)",
  "version": "1.0.0",
  "permissions": ["document:read", "document:write"],
  "code": { "/": "<code blob CID>" },
  "actions": [
    {
      "name": "find_replace",
      "title": "Find & Replace in Document",
      "description": "…",
      "input": { "/": "<input schema CID>" },
      "output": { "/": "<output schema CID>" }
    }
  ]
}
```

Rules (enforced by `validatePluginManifest`, shown in the install preview):
`name` is `[a-z0-9-]` (≤64); action names are `[a-z0-9_]` and unique; `code`
is a link; `input`/`output` are DAG-CBOR links; permissions come from the
vocabulary above; descriptions ≤1024 chars. The current
`PLUGIN_MANIFEST_SCHEMA_CID` is
`bafyreihqfltqulazz4erxr37nel6exe34fknmyrb26fixzzsimuhdwdqta` (also exported
from `@shm/ui/plugin-manifest`; the fixtures embed the schema blob itself).

Declare the **minimum** permissions. Zero-permission plugins install with a
green "fully isolated" badge.

## 5. Publishing

Compute each blob's CID client-side (dag-cbor blobs: canonical encode →
sha2-256 → CIDv1 `0x71`; the code blob: raw codec `0x55`) and store with
explicit CIDs — the daemon verifies them. From a script, the shape is:

```js
import * as cbor from '@ipld/dag-cbor'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {dagJsonToIpld} from '@shm/ui/dag-json'

const data = cbor.encode(dagJsonToIpld(value))
const cid = CID.createV1(0x71, await sha256.digest(data)).toString()
await client.request('PublishBlobs', {blobs: [{cid, data}]})
```

or publish a committed fixture with `grpcurl` (see
[`README.md`](./README.md#the-example-plugin)). Publish order doesn't matter
(CIDs are self-contained), but include the **manifest schema and blob
meta-schema blobs** so installers can resolve everything locally — the
fixtures show the full set.

Plugins are immutable: shipping a fix = publishing new blobs and sharing the
new manifest URL.

## 6. Install, run, iterate

1. Settings → **Plugins** → paste `ipfs://<manifestCid>` → review the
   permission preview → Install.
2. Run from the plugin row (**Run** buttons), or — for document-scoped
   plugins — from a **document's options menu** (Developer Mode), where
   `document.read`/`document.updateMetadata` operate on that open document
   with staged-draft semantics.
3. Ask the assistant: enabled actions are agent tools named
   `plugin_<name>__<action>` with your input schema compiled for the model.

Debugging: action errors surface verbatim in the run panel and to agents.
The three most common: a missing permission (the error names it), a schema
CID the daemon can't find (publish all blobs), and returning output that
doesn't match your output schema (advisory warning, not a failure).

## 7. Regenerating the committed fixtures

`src/__tests__/plugin-examples.test.ts` (packages/ui) recomputes every
fixture blob's CID and validates the manifests — if you change the dialect or
manifest schema, regenerate the fixtures with the same encode-and-write
pattern that test uses.
