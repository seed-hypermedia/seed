---
name: Onyx on the Hypermedia Network
summary: How the Hypermedia Network's real DAG-CBOR blobs — Change, Ref, Profile, Comment, Capability, Contact — are schemafied with Onyx.
---

# Hypermedia blobs — Onyx on real data

The Hypermedia Network stores its data as **DAG-CBOR blobs** in IPFS. There are
six signed blob types — Change, Ref, Profile, Comment, Capability, Contact — and
they are *related*: every one embeds the same signed envelope. This is a real,
production schemafication built entirely from the Onyx features in this repo, and
it lives under its own authority, `hm://seed.hyper.media/*` (local files
`hypermedia-*.json`).

## The shared base — extension in action

Every blob embeds a base envelope, [Signed blob](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-blob):

| field | type | meaning |
| --- | --- | --- |
| `type` | string | the blob discriminator ("Change", "Ref", …) |
| `signer` | `principal` (bytes) | the signer's public key |
| `sig` | `signature` (bytes) | signature over the blob |
| `ts` | `timestamp` (integer) | Unix-millisecond time |

Each concrete type **extends** it (Onyx extension — [the schema language](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema-language)),
inheriting those four fields and overriding `type` with a single-value enum:

- `hypermedia-change` — an append-only document change, linked into a causal DAG by `deps`; carries a `change-body` of ops.
- `hypermedia-ref` — a signed pointer from a space/path to the current head Changes.
- `hypermedia-profile` — an account's name / avatar / description (or an alias).
- `hypermedia-comment` — a threaded comment; body is a tree of `comment-block`s.
- `hypermedia-capability` — a delegation of a `role` (WRITER / AGENT) to a key.
- `hypermedia-contact` — one account's named reference to another.

Open `hypermedia-change` in the schema explorer: `signer`/`sig`/`ts`
show as **inherited**, the rest as **added**. That's the "block types are related"
relationship, made visible — and `hypermedia-blob`'s **Dependents** list is
exactly those six.

## Define your own signed blob type

The envelope is not reserved for the six built-in types. Any schema that extends [Signed blob](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-blob) and pins a `type` tag is a signed blob type the app knows how to create: in the schema editor, tick **Signed blob type**, set the tag (say `Vote`), add your fields, and publish the type as a schema-definition page. Its **Create** button then opens the signing form — you fill in only your fields; `signer`, `ts`, and `sig` are added at signing time with the selected account's key, and the blob is published with the same convention the daemon verifies (sign the canonical CBOR with the signature zeroed). The result is a first-class, verifiable blob on the network — with a `type` the built-in indexer ignores but any app that resolves your schema can trust and render. Browse any schema, built-in or yours, at `/hm/schema/<cid>`.

## The union — one of six

`hypermedia-any-blob` is the discriminated union of
all six, tagged on `type` — so "any Hypermedia blob" is a first-class type you can
validate against.

## Nested structure

A Change's body is a list of `op`s — themselves a union
(SetAttributes / MoveBlocks / ReplaceBlock / DeleteBlocks / SetKey). Content is
modeled by `block` and `annotation`,
both **open maps** (known fields + arbitrary inline attributes). Document
`metadata` is an open struct of known keys (`name`,
`summary`, `icon`, `cover`, `layout`, …) plus extras.

## Block types — a strict core anyone can extend

Document content is made of **blocks**. We want two things that pull in opposite
directions: **strict, concrete types** (so implementations can dispatch on
`block.type` with type-safe, per-type handlers) *and* **openness** (so a newer
client's block type doesn't make an older client reject the whole document).
These can't both live in a single validation pass — an open fallback always
swallows a malformed known block — so the model provides *layers*, and you pick
per workflow:

| workflow | needs | use |
| --- | --- | --- |
| rendering / dispatch | strict per-type shapes + graceful fallback | concrete types + `hypermedia-block` |
| authoring / editing | strict validation | `hypermedia-block-core` |
| sync / storage (forward-compat) | never reject unknown | `hypermedia-block` |
| codegen | the enumerable set | `hypermedia-block-core` |

- The fifteen **concrete blocks** — `hypermedia-block-paragraph`, `hypermedia-block-heading`, `hypermedia-block-code`, `hypermedia-block-math`, `hypermedia-block-image`, `hypermedia-block-video`, `hypermedia-block-file`, `hypermedia-block-button`, `hypermedia-block-embed`, `hypermedia-block-web-embed`, `hypermedia-block-nostr`, `hypermedia-block-table`, `hypermedia-block-table-row`, `hypermedia-block-table-column`, `hypermedia-block-query` — each **extends** `hypermedia-block-base`, closed, with a `type` enum and typed attributes.
- `hypermedia-block-core` — the **core union** we define (the fifteen). Strict: rejects anything else.
- `hypermedia-block` — the **open** block: `id` + `type` + arbitrary fields (via `onyx-any`). The forward-compatible wire type — a block type this client has *no schema for* (future or third-party) is still a valid Block, so a document is never rejected over it. This is *not* "your custom block type" (that's just extension + union, below); it's the open fallback for the *unknown*.

### Adding a block type

To add a block type, do exactly what the core blocks do — **extend
`hypermedia-block-base`** — then **union** it with
the core. No new machinery:

```json
// example-app-block: the core, PLUS this app's custom Poll block
{ "anyOf": [ { "ref": "hm://seed.hyper.media/block-core" },
             { "ref": "hm://example.com/poll-block" } ] }
```

See `example-poll-block` (a custom block extending
the same base) and `example-app-block`. That union is
**strict for its app** — it accepts core blocks and Polls but rejects a block
type it doesn't know — while the wire's `hypermedia-block`
stays open.

### Change is generic over its block type

To make *Change itself* strict over an app's block set — not just the wire block —
`hypermedia-change` is a **`Change<Block>`**: the
`Block` parameter threads through `change → change-body → op → op-replace-block`
(each level passes it down with `args`), defaulting to the extensible
`hypermedia-block`. An app instantiates it —
`example-myapp-change` = `Change<example-app-block>`
— and now a `ReplaceBlock` op carrying a block type the app doesn't know is
rejected *four levels deep* (`$.body.ops[0].block`), while the default Change
still accepts anything. This is real generic abstraction (`params` / `var` /
`args`); see [the schema language](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema-language).

## CBOR value shapes

The wire types map onto Onyx primitives, wrapped as self-explanatory aliases:

| Hypermedia | CBOR | Onyx |
| --- | --- | --- |
| `principal`, `signature` | byte string | `bytes` |
| `cid` | CBOR tag-42 link | `link` |
| `timestamp` | int64 (Unix ms) | `integer` |

Every one of these schemas is validated in `validate.mjs` — as a
well-formed schema, and against real blob-shaped data (a Ref, a Capability, a
Change with ops, the union, and metadata), with negative cases for wrong `type`
tags, missing required fields, and unknown keys.

## Seed API read models

Beyond the signed blobs, the `seed-*` schemas type the **derived data the Seed
daemon computes for clients** — not signed network data, but the read models the
apps consume: `seed-resource` (the union of every state a fetched resource can
be in: document, comment, redirect, not-found, tombstone, error), `seed-document`
and `seed-comment` (the API payload forms, with resolved versions, authors and
timestamps), `seed-citation`, `seed-interaction-summary`, `seed-search-results`,
`seed-site-member`, `seed-contact-record`, and `seed-discovery-status`, built on
`seed-id` (the parsed form of an `hm://` identifier). Typing these closes the
loop: the same ontology describes what is signed on the wire AND what the API
serves back.
