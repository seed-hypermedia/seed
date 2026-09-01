---
name: How Onyx Works
summary: The system end to end — from a schema file in the repository to a signed blob on the network, a browsable document, a resolved reference in the app, a generated TypeScript type, and a typed API call.
---

# How Onyx Works

The system end to end — from a schema file in the repository to a signed blob on the network, a browsable document, a resolved reference in the app, a generated TypeScript type, and a typed API call.

## In one paragraph

A schema is written as a small JSON file. A publisher hashes it to its DAG-CBOR CID and records that in a lockfile. A sync uploads the blob and publishes a companion document at an `hm://` URL under the Onyx account, whose metadata points at the blob. Apps bundle the library, resolve any other reference over the network, and run one validation engine — the same one the reference validator uses — to drive explorers, editors, forms, and warnings. A generator turns every schema into a TypeScript type. And the read API is itself described by schemas, so the API console is derived rather than written. Each of those is a layer below.

```
  onyx/<name>.json ──publish.mjs──▶ schemas.lock.json (name → CID)
        │  + <name>.md                      │
        │                                   ▼
        └──────sync-onyx──▶ DAG-CBOR blob (ipfs://<cid>)
                              + document hm://<onyx>/<name>
                                  metadata.schemaDefinition = ipfs://<cid>
                                            │
              ┌─────────────────────────────┼──────────────────────────┐
              ▼                             ▼                          ▼
   bundled registry in the app     resolved over the network     typegen.mjs
   (schema pages, editors, …)      (schema / childrenSchema)     (TS types)
```

## Layer 1 — Values and the codec

Everything Onyx types is an IPLD value: one of nine kinds — `null`, `boolean`, `integer`, `float`, `string`, `bytes`, `list`, `map`, `link`. The canonical form is DAG-CBOR, a deterministic binary encoding with first-class links (CIDs). The human form is dag-json, a lossless JSON projection that spells a link as `{"/": "bafy…"}` and bytes as `{"/": {"bytes": "…"}}`. Everything in the repository is written in dag-json; everything on the network is DAG-CBOR. The two are projections of one graph, and the transform between them is mechanical. See [the data model](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/data-model) and [encoding](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/encoding).

## Layer 2 — Schemas and the meta-schema

A schema is a `map` value that constrains other values. It takes one of seven shapes: a `map` schema (a struct, or an open map via `values`), a `list` schema, a `scalar` schema (with optional `enum` and value constraints), a `link` schema (a typed CID), an `include` (a bare `ref`), a `union` (`anyOf`), or a `var` (a type variable for generics). The meta-schema — the schema of schemas — is the discriminated union of those seven, and it validates as an instance of itself. That loop is checked on every run of the reference validator. See [the schema language](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema-language).

## Layer 3 — The library

The library is a folder of pairs: `<name>.json` (the schema, in dag-json) and `<name>.md` (its human explanation). Four families live side by side, distinguished by prefix:

| prefix | family | examples |
| --- | --- | --- |
| `onyx-` | the meta-schema, its seven variants, and one canonical primitive per kind | `onyx-schema`, `onyx-map-schema`, `onyx-string` |
| `hypermedia-` | the Hypermedia Network's real blobs and the full block model | `hypermedia-change`, `hypermedia-block-table`, `hypermedia-document` |
| `seed-` | the Seed API's read models and its RPC catalog | `seed-resource`, `seed-search-results`, `seed-rpc-query` |
| `example-` | teaching schemas covering every feature, plus live instances | `example-person`, `example-folder`, `example-bob` |

Inside a schema, every reference is an `hm://` URL under the Onyx account: `hm://z6MkmZUb…/string`, `hm://z6MkmZUb…/hypermedia-metadata`. Primitives and meta-schema drop their `onyx-` prefix in public; everything else keeps its prefix. A reference is therefore always a real, published, clickable document — never a dead placeholder.

## Layer 4 — Publishing

Two scripts turn the folder into the network.

**`publish.mjs`** encodes each schema to canonical DAG-CBOR, hashes it, and writes `schemas.lock.json`: a manifest from every `hm://` URL to its content CID. The lockfile is the contract between the repository and the network; a schema cannot silently change without the lockfile changing with it.

**`sync-onyx`** signs in as the Onyx account and publishes three things. First, every schema blob, after re-computing each CID and refusing to continue if any disagrees with the lockfile. Second, one document per schema at its public name, whose content is the companion markdown: a **type** document carries `schemaDefinition = ipfs://<cid>` (this document defines a type), while an **instance** document — a file shaped `{$type, value}`, like `example-bob` — carries `schema = <$type>` (this document conforms to a type). Third, the narrative pages you are reading, from a `site/` folder, with `home` at the account root.

The result is that the type system dogfoods the network it types: browse the account and you are browsing the library.

## Layer 5 — Resolution

A schema reference can arrive in three forms, and the app resolves each differently:

| reference | example | how it resolves |
| --- | --- | --- |
| bundled library URL | `hm://z6MkmZUb…/map` | locally, from the registry compiled into the app — no network |
| IPFS CID | `ipfs://bafy…` | fetch the blob directly (bundled if known, otherwise from the daemon) |
| any Hypermedia document URL | `hm://acme/person` | fetch the document, read its `metadata.schemaDefinition`, then fetch that blob |

The third form is what makes types extensible by anyone: a schema published under any account is as resolvable as one from the library. Because network resolution is asynchronous, the app exposes it through hooks — one that resolves a single reference, and one that computes a document's *effective* schema (its own `schema`, or its parent's `childrenSchema`). See [typed documents](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/typed-documents).

## Layer 6 — The engine and the app

There is one validation engine. The dependency-free reference validator proves the meta-schema describes itself, validates every schema in the library against it, checks positive and negative data cases for the examples, and confirms the union rejects malformed schemas. That same engine is ported line-for-line into the app, so nothing the app shows can disagree with the reference oracle. On top of it sit:

- the **schema browser** (`/hm/schema/<cid>`) — every schema rendered as a page with fields, variants, inherited versus added properties, generic parameters, targets, URL and CID, dependencies and dependents, a New button, and — for API methods — a live call panel;
- the **schema editor** — a form driven by the meta-schema, so it can only produce valid schemas;
- the **value editor** — a schema-respecting form for building conforming data: dropdowns for enums and union variants, the right controls for `link` and `bytes`, title pills for document references, file pickers for IPFS references;
- the **document integration** — required attributes as fixed rows, red non-blocking validation, and the header actions on a schema-definition document;
- the **inspector** — recognizes the signed blob types, detects when a blob *is* a schema, and validates a blob against its attached schema.

These live behind Developer Mode in the Seed app (on by default on the web). The library is browsed through its own published documents (this site); any schema blob, bundled or published, has a full page at `/hm/schema/<cid>` where every reference — a library type, an `hm://` type document, an `ipfs://` schema — is a link, so a schema graph is browsed by clicking. Signed-blob schemas (anything extending [Signed blob](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-blob)) get a signing form instead of a plain editor: the envelope is filled and signed with the selected account at publish time.

## Layer 7 — Generated code

`typegen.mjs` walks the library and emits one TypeScript type per schema: maps become object types, `enum` becomes a literal union, `anyOf` a union, extension an intersection, open maps an index signature, and `params` / `var` / `args` real generics — so `Change<Block>` in the schema is `Change<Block>` in TypeScript. Self-referential schemas like a recursive JSON value come out as legal recursive types. A `--check` mode fails when the generated file is stale. The schemas, not hand-written type declarations, are the source of truth for the app's data types.

## Layer 8 — The typed API

The last layer turns the machinery on the API itself. Every read method of the Seed universal client — `request(key, input) → output` — is a `seed-rpc-*` schema that pins its method key as a single-value enum and types `input` and `output` by reference to the read-model schemas. `seed-rpc` is the union of all of them. The in-app API console reads that union to build its method picker, uses the value editor for inputs, and validates both directions advisorily. Adding a method to the catalog is adding a schema. See [the typed API](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/api).

## The invariants

Everything above holds together because of a handful of properties that are checked, not assumed:

- **Same bytes, same CID.** Canonical DAG-CBOR encoding means any implementation hashing a schema gets the lockfile's CID; the sync refuses to publish otherwise.
- **The meta-schema validates itself**, and rejects malformed schemas — verified on every validator run.
- **One engine.** The app's validation is a port of the reference validator, covered by the same cases.
- **Every reference is a document.** There are no placeholder names; each `hm://` in a schema resolves to a published page.
- **Generated code matches the library.** `typegen --check` and the bundled-registry generator fail the build when out of date.
- **Warnings never block writes.** A document with out-of-spec data still saves; the mismatch is shown, not enforced.
