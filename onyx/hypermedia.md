# Hypermedia blobs — Onyx on real data

The Hypermedia Network stores its data as **DAG-CBOR blobs** in IPFS. There are
six signed blob types — Change, Ref, Profile, Comment, Capability, Contact — and
they are *related*: every one embeds the same signed envelope. This is a real,
production schemafication built entirely from the Onyx features in this repo, and
it lives under its own authority, `hm://seed.hyper.media/*` (local files
`hypermedia-*.json`).

## The shared base — extension in action

Every blob embeds a base envelope ([`hypermedia-blob`](./hypermedia-blob.json)):

| field | type | meaning |
| --- | --- | --- |
| `type` | string | the blob discriminator ("Change", "Ref", …) |
| `signer` | [`principal`](./hypermedia-principal.json) (bytes) | the signer's public key |
| `sig` | [`signature`](./hypermedia-signature.json) (bytes) | signature over the blob |
| `ts` | [`timestamp`](./hypermedia-timestamp.json) (integer) | Unix-millisecond time |

Each concrete type **extends** it (Onyx extension — [schema-language.md](./schema-language.md)),
inheriting those four fields and overriding `type` with a single-value enum:

- [`hypermedia-change`](./hypermedia-change.json) — an append-only document change, linked into a causal DAG by `deps`; carries a [`change-body`](./hypermedia-change-body.json) of ops.
- [`hypermedia-ref`](./hypermedia-ref.json) — a signed pointer from a space/path to the current head Changes.
- [`hypermedia-profile`](./hypermedia-profile.json) — an account's name / avatar / description (or an alias).
- [`hypermedia-comment`](./hypermedia-comment.json) — a threaded comment; body is a tree of [`comment-block`](./hypermedia-comment-block.json)s.
- [`hypermedia-capability`](./hypermedia-capability.json) — a delegation of a [`role`](./hypermedia-role.json) (WRITER / AGENT) to a key.
- [`hypermedia-contact`](./hypermedia-contact.json) — one account's named reference to another.

Open [`hypermedia-change`](./hypermedia-change.json) in the tour: `signer`/`sig`/`ts`
show as **inherited**, the rest as **added**. That's the "block types are related"
relationship, made visible — and `hypermedia-blob`'s **Dependents** list is
exactly those six.

## The union — one of six

[`hypermedia-any-blob`](./hypermedia-any-blob.json) is the discriminated union of
all six, tagged on `type` — so "any Hypermedia blob" is a first-class type you can
validate against.

## Nested structure

A Change's body is a list of [`op`](./hypermedia-op.json)s — themselves a union
(SetAttributes / MoveBlocks / ReplaceBlock / DeleteBlocks / SetKey). Content is
modeled by [`block`](./hypermedia-block.json) and [`annotation`](./hypermedia-annotation.json),
both **open maps** (known fields + arbitrary inline attributes). Document
[`metadata`](./hypermedia-metadata.json) is an open struct of known keys (`name`,
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
| rendering / dispatch | strict per-type shapes + graceful fallback | concrete types + [`hypermedia-block`](./hypermedia-block.json) |
| authoring / editing | strict validation | [`hypermedia-block-core`](./hypermedia-block-core.json) |
| sync / storage (forward-compat) | never reject unknown | [`hypermedia-block`](./hypermedia-block.json) |
| codegen | the enumerable set | [`hypermedia-block-core`](./hypermedia-block-core.json) |

- The eleven **concrete blocks** — [`paragraph`](./hypermedia-block-paragraph.json), [`heading`](./hypermedia-block-heading.json), [`code`](./hypermedia-block-code.json), [`math`](./hypermedia-block-math.json), [`image`](./hypermedia-block-image.json), [`video`](./hypermedia-block-video.json), [`file`](./hypermedia-block-file.json), [`button`](./hypermedia-block-button.json), [`embed`](./hypermedia-block-embed.json), [`web-embed`](./hypermedia-block-web-embed.json), [`nostr`](./hypermedia-block-nostr.json) — each **extends** [`hypermedia-block-base`](./hypermedia-block-base.json), closed, with a `type` enum and typed attributes.
- [`hypermedia-block-core`](./hypermedia-block-core.json) — the **core union** we define (the eleven). Strict: rejects anything else.
- [`hypermedia-block`](./hypermedia-block.json) — the **open** block: `id` + `type` + arbitrary fields (via [`onyx-any`](./onyx-any.json)). The forward-compatible wire type — a block type this client has *no schema for* (future or third-party) is still a valid Block, so a document is never rejected over it. This is *not* "your custom block type" (that's just extension + union, below); it's the open fallback for the *unknown*.

### Adding a block type

To add a block type, do exactly what the core blocks do — **extend
[`hypermedia-block-base`](./hypermedia-block-base.json)** — then **union** it with
the core. No new machinery:

```json
// example-app-block: the core, PLUS this app's custom Poll block
{ "anyOf": [ { "ref": "hm://seed.hyper.media/block-core" },
             { "ref": "hm://example.com/poll-block" } ] }
```

See [`example-poll-block`](./example-poll-block.json) (a custom block extending
the same base) and [`example-app-block`](./example-app-block.json). That union is
**strict for its app** — it accepts core blocks and Polls but rejects a block
type it doesn't know — while the wire's [`hypermedia-block`](./hypermedia-block.json)
stays open.

### Change is generic over its block type

To make *Change itself* strict over an app's block set — not just the wire block —
[`hypermedia-change`](./hypermedia-change.json) is a **`Change<Block>`**: the
`Block` parameter threads through `change → change-body → op → op-replace-block`
(each level passes it down with `args`), defaulting to the extensible
[`hypermedia-block`](./hypermedia-block.json). An app instantiates it —
[`example-myapp-change`](./example-myapp-change.json) = `Change<example-app-block>`
— and now a `ReplaceBlock` op carrying a block type the app doesn't know is
rejected *four levels deep* (`$.body.ops[0].block`), while the default Change
still accepts anything. This is real generic abstraction (`params` / `var` /
`args`); see [schema-language.md](./schema-language.md#generics).

## CBOR value shapes

The wire types map onto Onyx primitives, wrapped as self-explanatory aliases:

| Hypermedia | CBOR | Onyx |
| --- | --- | --- |
| [`principal`](./hypermedia-principal.json), [`signature`](./hypermedia-signature.json) | byte string | `bytes` |
| [`cid`](./hypermedia-cid.json) | CBOR tag-42 link | `link` |
| [`timestamp`](./hypermedia-timestamp.json) | int64 (Unix ms) | `integer` |

Every one of these schemas is validated in [`validate.mjs`](./validate.mjs) — as a
well-formed schema, and against real blob-shaped data (a Ref, a Capability, a
Change with ops, the union, and metadata), with negative cases for wrong `type`
tags, missing required fields, and unknown keys.
