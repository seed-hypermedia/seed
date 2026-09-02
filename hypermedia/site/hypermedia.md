---
name: Onyx on the Hypermedia Network
summary: How the Hypermedia Network's real DAG-CBOR blobs — Change, Ref, Profile, Comment, Capability, Contact — are schemafied with Onyx.
---
# Hypermedia blobs — Onyx on real data <!-- id:MZbfGNFo -->
The Hypermedia Network stores its data as **DAG-CBOR blobs** in IPFS. There are six signed blob types — Change, Ref, Profile, Comment, Capability, Contact — and they are _related_: every one embeds the same signed envelope. This is a real, production schemafication built entirely from the Onyx features in this repo, and it lives under its own authority, `hm://seed.hyper.media/*` (local files `hypermedia-*.json`). <!-- id:mIEsrB_H -->

## The shared base — extension in action <!-- id:5NuFY-Ul -->
Every blob embeds a base envelope, [Signed blob](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-blob): <!-- id:iAwaugHT -->

<!-- id:fmRGB5ga -->
| field <!-- col:Na_LusWI --> | type <!-- col:YfdND9jO --> | meaning <!-- col:apHHZNTY --> <!-- id:L2hr53_i --> |
| --- | --- | --- |
| `type` | string | the blob discriminator ("Change", "Ref", …) <!-- id:LNP4UQva --> |
| `signer` | `principal` (bytes) | the signer's public key <!-- id:zLRfKK_J --> |
| `sig` | `signature` (bytes) | signature over the blob <!-- id:-Ei4jwGH --> |
| `ts` | `timestamp` (integer) | Unix-millisecond time <!-- id:KFMnuu6T --> |

Each concrete type **extends** it (Onyx extension — [the schema language](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema-language)), inheriting those four fields and overriding `type` with a single-value enum: <!-- id:zUkl9LQZ -->
  - `hypermedia-change` — an append-only document change, linked into a causal DAG by `deps`; carries a `change-body` of ops. <!-- id:XNtWFQFG -->
  - `hypermedia-ref` — a signed pointer from a space/path to the current head Changes. <!-- id:z0t8cH-b -->
  - `hypermedia-profile` — an account's name / avatar / description (or an alias). <!-- id:kuRmAvLb -->
  - `hypermedia-comment` — a threaded comment; body is a tree of `comment-block`s. <!-- id:4B_lboNh -->
  - `hypermedia-capability` — a delegation of a `role` (WRITER / AGENT) to a key. <!-- id:04geSQaa -->
  - `hypermedia-contact` — one account's named reference to another. <!-- id:A4ma4Edr -->

Open `hypermedia-change` in the schema explorer: `signer`/`sig`/`ts` show as **inherited**, the rest as **added**. That's the "block types are related" relationship, made visible — and `hypermedia-blob`'s **Dependents** list is exactly those six. <!-- id:S58y-fEh -->

## Define your own signed blob type <!-- id:m8JR3RPQ -->
The envelope is not reserved for the six built-in types. Any schema that extends [Signed blob](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-blob) and pins a `type` tag is a signed blob type the app knows how to create: in the schema editor, tick **Signed blob type**, set the tag (say `Vote`), add your fields, and publish the type as a schema-definition page. Its **Create** button then opens the signing form — you fill in only your fields; `signer`, `ts`, and `sig` are added at signing time with the selected account's key, and the blob is published with the same convention the daemon verifies (sign the canonical CBOR with the signature zeroed). The result is a first-class, verifiable blob on the network — with a `type` the built-in indexer ignores but any app that resolves your schema can trust and render. Browse any schema, built-in or yours, at `/hm/schema/<cid>`. <!-- id:bcuDPBiZ -->

## The union — one of six <!-- id:TePpgQkJ -->
`hypermedia-any-blob` is the discriminated union of all six, tagged on `type` — so "any Hypermedia blob" is a first-class type you can validate against. <!-- id:HYLU7eY7 -->

## Nested structure <!-- id:dM0xRByE -->
A Change's body is a list of `op`s — themselves a union (SetAttributes / MoveBlocks / ReplaceBlock / DeleteBlocks / SetKey). Content is modeled by `block` and `annotation`, both **open maps** (known fields + arbitrary inline attributes). Document `metadata` is an open struct of known keys (`name`, `summary`, `icon`, `cover`, `layout`, …) plus extras. <!-- id:ahKth012 -->

## Block types — a strict core anyone can extend <!-- id:5qbaLYVx -->
Document content is made of **blocks**. We want two things that pull in opposite directions: **strict, concrete types** (so implementations can dispatch on `block.type` with type-safe, per-type handlers) _and_ **openness** (so a newer client's block type doesn't make an older client reject the whole document). These can't both live in a single validation pass — an open fallback always swallows a malformed known block — so the model provides _layers_, and you pick per workflow: <!-- id:6ghDI01J -->

<!-- id:HpD_T3GL -->
| workflow <!-- col:A8vgaFo4 --> | needs <!-- col:FIP8KiW3 --> | use <!-- col:th7BETUL --> <!-- id:3LkiV5Ju --> |
| --- | --- | --- |
| rendering / dispatch | strict per-type shapes + graceful fallback | concrete types + `hypermedia-block` <!-- id:wtvu7DPR --> |
| authoring / editing | strict validation | `hypermedia-block-core` <!-- id:Ro2A82OD --> |
| sync / storage (forward-compat) | never reject unknown | `hypermedia-block` <!-- id:AINzic-b --> |
| codegen | the enumerable set | `hypermedia-block-core` <!-- id:U7UTeDDh --> |

<!-- id:nNN-eoL8 -->
- The fifteen **concrete blocks** — `hypermedia-block-paragraph`, `hypermedia-block-heading`, `hypermedia-block-code`, `hypermedia-block-math`, `hypermedia-block-image`, `hypermedia-block-video`, `hypermedia-block-file`, `hypermedia-block-button`, `hypermedia-block-embed`, `hypermedia-block-web-embed`, `hypermedia-block-nostr`, `hypermedia-block-table`, `hypermedia-block-table-row`, `hypermedia-block-table-column`, `hypermedia-block-query` — each **extends** `hypermedia-block-base`, closed, with a `type` enum and typed attributes. <!-- id:85wzIKeC -->
- `hypermedia-block-core` — the **core union** we define (the fifteen). Strict: rejects anything else. <!-- id:Tp6vmRo8 -->
- `hypermedia-block` — the **open** block: `id` + `type` + arbitrary fields (via `onyx-any`). The forward-compatible wire type — a block type this client has _no schema for_ (future or third-party) is still a valid Block, so a document is never rejected over it. This is _not_ "your custom block type" (that's just extension + union, below); it's the open fallback for the _unknown_. <!-- id:idnijeex -->

### Adding a block type <!-- id:YUxiFSMb -->
To add a block type, do exactly what the core blocks do — **extend `hypermedia-block-base`** — then **union** it with the core. No new machinery: <!-- id:moIAnCWY -->

```json <!-- id:TQDZHz8Q -->
// example-app-block: the core, PLUS this app's custom Poll block
{ "anyOf": [ { "ref": "hm://seed.hyper.media/block-core" },
             { "ref": "hm://example.com/poll-block" } ] }
```

See `example-poll-block` (a custom block extending the same base) and `example-app-block`. That union is **strict for its app** — it accepts core blocks and Polls but rejects a block type it doesn't know — while the wire's `hypermedia-block` stays open. <!-- id:uKNf26fA -->

### Change is generic over its block type <!-- id:lMDDR7Ax -->
To make _Change itself_ strict over an app's block set — not just the wire block — `hypermedia-change` is a **`Change<Block>`**: the `Block` parameter threads through `change → change-body → op → op-replace-block` (each level passes it down with `args`), defaulting to the extensible `hypermedia-block`. An app instantiates it — `example-myapp-change` = `Change<example-app-block>` — and now a `ReplaceBlock` op carrying a block type the app doesn't know is rejected _four levels deep_ (`$.body.ops[0].block`), while the default Change still accepts anything. This is real generic abstraction (`params` / `var` / `args`); see [the schema language](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema-language). <!-- id:-HAjdTZA -->

## CBOR value shapes <!-- id:IMRnqrVW -->
The wire types map onto Onyx primitives, wrapped as self-explanatory aliases: <!-- id:LTD8_m45 -->

<!-- id:vu31Ab-i -->
| Hypermedia <!-- col:j2TJEeAE --> | CBOR <!-- col:MtDD3BVp --> | Onyx <!-- col:oSB2aUn3 --> <!-- id:arRS7EvK --> |
| --- | --- | --- |
| `principal`, `signature` | byte string | `bytes` <!-- id:TzmlTPbZ --> |
| `cid` | CBOR tag-42 link | `link` <!-- id:IJ4BEYnA --> |
| `timestamp` | int64 (Unix ms) | `integer` <!-- id:2fLazMHg --> |

Every one of these schemas is validated in `validate.mjs` — as a well-formed schema, and against real blob-shaped data (a Ref, a Capability, a Change with ops, the union, and metadata), with negative cases for wrong `type` tags, missing required fields, and unknown keys. <!-- id:jy52yYgY -->

## Seed API read models <!-- id:dVV5nKIm -->
Beyond the signed blobs, the `seed-*` schemas type the **derived data the Seed daemon computes for clients** — not signed network data, but the read models the apps consume: `seed-resource` (the union of every state a fetched resource can be in: document, comment, redirect, not-found, tombstone, error), `seed-document` and `seed-comment` (the API payload forms, with resolved versions, authors and timestamps), `seed-citation`, `seed-interaction-summary`, `seed-search-results`, `seed-site-member`, `seed-contact-record`, and `seed-discovery-status`, built on `seed-id` (the parsed form of an `hm://` identifier). Typing these closes the loop: the same ontology describes what is signed on the wire AND what the API serves back. <!-- id:jteK8i91 -->