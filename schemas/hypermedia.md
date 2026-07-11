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
