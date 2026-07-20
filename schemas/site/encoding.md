---
name: Encoding
summary: DAG-CBOR as the canonical wire form, the dag-json human projection, canonical encoding, and the publish pipeline.
---

# Encoding: DAG-CBOR and the dag-json human form

Onyx values — both schemas and the data they type — are **DAG-CBOR blocks** on
IPFS. DAG-CBOR is a restricted, deterministic profile of CBOR (binary) with
first-class support for links (CIDs). It is the canonical, on-the-wire form.

DAG-CBOR is not human-editable, so in this repo everything is written in
**dag-json**: the JSON projection of the same data model. dag-json is a
faithful, lossless-enough rendering that a person can read and diff, and that
tools can convert to and from DAG-CBOR.

```
   dag-json  (this repo, human form)  <——>  DAG-CBOR  (IPFS, canonical form)
   JSON text, filename refs                  binary, CID refs
```

## The reserved-key envelopes

JSON has no native way to write bytes or a link, so dag-json borrows the map
syntax with **one reserved key, `/`**:

| kind | dag-json | DAG-CBOR |
| --- | --- | --- |
| link | `{"/":"bafy…"}` | CID (tag 42) |
| bytes | `{"/":{"bytes":"aGVsbG8"}}` | byte string (major type 2), base64 in JSON |

**These are not maps.** They are the JSON *spelling* of two distinct kinds. In
DAG-CBOR the ambiguity disappears — a link is a tagged CID, bytes are a byte
string — but in dag-json they wear map syntax. This is the source of dag-json's
one footgun: a genuine data map that happens to have a single `/` key is
indistinguishable from a link.

Onyx's rule keeps you clear of it (see [the data model](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/data-model)): links
and bytes are **atomic kinds**, never described as maps in a schema. A schema
says `{"type":"link"}`, full stop — it never reaches inside the envelope. The
reference validator (`validate.mjs`) enforces the distinction: `typeOf`
recognizes the two envelopes and reports `link` / `bytes`, so a value typed
`map` will *reject* a `{"/":…}` shape, and vice versa.

## Canonical encoding matters

CIDs are content hashes, so **the same value must always encode to the same
bytes** or its CID would change. DAG-CBOR mandates a canonical form:

- map keys sorted by a defined ordering,
- shortest-form integer encodings,
- no floating-point NaN/Infinity,
- exactly one way to encode any value.

The upshot for authoring: **key order and formatting in these JSON files are
cosmetic.** Whitespace and the order you happen to write `properties` in do not
affect the resulting block or its CID — the encoder normalizes everything. Two
schemas that differ only in key order are the *same block* with the *same CID*.

## The publish pipeline

`publish.mjs` turns this repo into live Onyx types:

1. Parse each `.json` file (dag-json). `ref`s are already **`hm://` URLs** —
   names, *not* CIDs — so recursive and mutually-recursive schemas keep working
   (see [references](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/references)). They are **not** rewritten.
2. Canonically encode each schema to DAG-CBOR and content-address it: a CIDv1,
   sha2-256, `dag-cbor` (0x71) — the same codec the backend uses for its blobs.
3. Write `schemas.lock.json`: the manifest mapping each
   `hm://` URL → its CID. Publish/pin the blocks under their authority at their
   `hm://` paths (signed by the authority's key).

Because canonical DAG-CBOR is deterministic, **the CID is a pure function of a
schema's content** — CI and any runtime that recomputes it reach the exact same
CID. Two consequences worth calling out:

- Run `node publish.mjs --check` in CI: it fails if the lockfile is stale, and a
  CID that changes in a diff is a schema that changed.
- Because a schema links others by **name**, its CID depends only on its own
  bytes — editing `block` does **not** churn `change`'s CID (unlike a CID/Merkle
  graph, where any change propagates upward). Names give stable, independent
  content addresses; the manifest is the separate name → CID index a resolver
  uses.

Anyone can then resolve a schema by its `hm://` name (via the manifest or the
authority), or fetch an exact version by CID, DAG-CBOR-decode it, and type-check
data against it — the same validation this repo runs locally.
