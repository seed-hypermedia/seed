# Walkthrough: schemas for blobs, end to end

A user-level tour of the feature as built. Desktop app only (the underlying
primitives all work on web, but no web surface exists yet).

## 1. Create a schema

Document options dropdown → **New Schema**. This opens the blob editor seeded
with a `schema` link to the built-in **meta-schema** — meaning the editor
already knows the vocabulary of schemas and helps you author one:

- The add-field form suggests schema keywords (`title`, `type`, `properties`,
  `required`, `enum`, …) with the right input types.
- `type` values render as a select (`null`/`boolean`/`integer`/`number`/
  `string`/`array`/`object`); `kind` offers `link`/`bytes` for IPLD fields.
- Anything the meta-schema doesn't recognize just gets a gentle amber badge —
  you can author whatever you want.

Describe your data under `properties`, list `required` keys, add `enum`s,
bounds, `default`s. For IPLD fields use `kind: "link"` (optionally with
`targetSchema` linking another schema blob) or `kind: "bytes"` (optionally
`maxBytes`).

Hit **Publish**. The schema is encoded as canonical DAG-CBOR, stored on your
node under its `ipfs://CID` URL (shown in the omnibar, copyable from the
options menu). The meta-schema blob is stored alongside it automatically so the
schema's own `schema` link always resolves.

**Schemas are immutable.** Editing a published schema and publishing again
creates a *new* schema at a *new* CID; blobs pointing at the old CID keep the
exact schema they were written against.

## 2. Create an instance

On a published schema, options menu → **New Instance of this Schema**. You get
a new blob pre-shaped by the schema: `default` values filled in, required
fields materialized with sensible empty values, and the `schema` field already
linking the schema. Fill it in — enum fields are selects, required-but-missing
fields appear as one-click add chips, the add form suggests declared field
names — and **Publish**.

The published instance carries a **real IPLD link** to its schema (CBOR tag
42), so blob→schema is a solid, traversable DAG edge, like every other link in
the blob.

## 3. Attach a schema to any blob

Open any DAG-CBOR blob (paste its `ipfs://` URL into the omnibar), options
menu → **Attach Schema…**, paste a schema CID or `ipfs://` URL. The attachment
is just a `schema` field on the value — undoable, visible, removable like any
field. Publishing creates a new CID for the now-schema-attached blob (blobs
are immutable; "attach" really means "derive").

## 4. What validation does — and deliberately does not — do

With a schema attached, a quiet status row appears under the CID line:

- **"Matches schema"** when the data conforms.
- **"N fields don't match the schema — kept as-is"** when it doesn't.

Fields that violate the schema get an amber badge with the specifics in a
tooltip. And that is *all* that happens:

- Nothing is blocked. You can edit, add, remove, paste, and **publish**
  non-conforming data freely.
- Nothing is coerced or rewritten. A `status` outside the enum stays exactly
  the text you typed (it just shows free text + a badge instead of the select).
- Nothing is hidden or deleted. Unknown fields under
  `additionalProperties: false` stay fully editable.
- A schema that can't be fetched yet is treated as *unknown*, never as a
  violation — the editor shows "Loading schema…" and keeps working.

## 5. Schemas referencing schemas

Inside a schema, `$ref` comes in two forms:

- `"$ref": "#/$defs/Name"` — internal reuse within the same schema blob
  (recursive types allowed).
- `"$ref": {"/": "<cid>"}` — a real IPLD link to another schema blob. The
  editor fetches the whole reference closure automatically; the daemon can pin
  and traverse these edges like any DAG.

Because content addressing forbids forward references, schema→schema link
cycles are impossible by construction.

## 6. Sharp edges to know about

- **Reserved daemon types**: a blob containing a `type` field immediately
  followed by one of the daemon's signed-blob type names (`Comment`, `Change`,
  `Ref`, `Capability`, `Contact`, `Profile`) can't be stored — the daemon
  reserves those shapes. The editor explains this clearly if you hit it.
  JSON-Schema-style lowercase `type: "object"` etc. is unaffected.
- **`"/"` field names** are reserved by DAG-JSON for links/bytes; the editor
  refuses to create them.
- **Big integers** beyond 2^53 may lose precision through the JSON editing
  path (pre-existing blob-editor limitation).
