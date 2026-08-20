# Walkthrough: schemas for blobs, end to end

A user-level tour of the feature as built. Desktop app only (the underlying
primitives all work on web, but no web surface exists yet). The document
options entries (New Blob / New Schema) appear behind **Developer Mode**
(Settings → Developers); the blob/schema editor's own options menu always
offers them.

## 1. Create a schema

Document options dropdown → **New Schema**. This opens a **purpose-built
schema form** (not the generic field editor): every schema attribute has a
permanent control, and only the controls relevant to the current type are
shown.

- **Title** and **Description** sit at the top.
- **"Schema of"** picks what the schema describes: Object, Text, Whole number,
  Number, Toggle, List, Link, Bytes, Null, Reference, or Any.
- Pick **Object** (the default for a new schema) and you get a **fields
  table**: add fields by name + type, rename inline, expand a row to edit its
  label, help text, and type-specific options, toggle **Required** per field,
  and flip **"Allow fields beyond the ones declared above"**
  (`additionalProperties` — this switch only exists on object schemas).
- Pick **Text** and you get length bounds, a pattern, and a default. Numbers
  get min/max; Lists get an "each item" sub-form; **Link** gets an optional
  target schema CID; **Bytes** gets a max size; **Reference** takes
  `#/$defs/Name` or another schema's CID.
- Pick **Literal Union** for a fixed set of allowed values — typed chips
  where numbers, `true`/`false`, and `null` are detected and quotes force
  text. Instances edit these as dropdowns.
- Pick **HM Url** or **HM Profile** for hypermedia references. Instances get
  a search box (documents, or accounts only for profiles) that also accepts a
  pasted `hm://` URL; a chosen reference displays as its **title**, not the
  URL. Profiles store the bare `hm://<accountUid>` form.
- Pick **Union** for a value matching one of several variants. For a tagged
  (discriminated) union of objects, give every variant the same field (e.g.
  `kind`) as a Literal Union with one distinct value — warnings then point
  into the matching variant precisely.
- A **Definitions** section manages reusable `$defs` at the root.
- New fields are added with a name, type, and a **Required** toggle; each
  existing field row has the same toggle (the schema's `required` list is
  managed for you, never edited as a separate list).

The form is a view over the plain dialect value: anything it doesn't surface
is preserved untouched, and the options menu offers **Edit as Raw Fields**
and **Edit as JSON** for full access.

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

## 6. Schema-typed document metadata

A document metadata field whose **key** is a schema's `ipfs://` URL is
schema-typed: its value gets the full advisory treatment (dropdowns for
literal unions, required chips, warning badges) driven by that schema. In the
document's Metadata view, use the schema button in the header, paste a
schema's `ipfs://` URL, and the field is created with the URL as its key and
a starter value shaped by the schema. Values stay within what metadata can
publish (text, whole numbers, toggles, nested objects).

## 7. Sharp edges to know about

- **Reserved daemon types**: a blob containing a `type` field immediately
  followed by one of the daemon's signed-blob type names (`Comment`, `Change`,
  `Ref`, `Capability`, `Contact`, `Profile`) can't be stored — the daemon
  reserves those shapes. The editor explains this clearly if you hit it.
  JSON-Schema-style lowercase `type: "object"` etc. is unaffected.
- **`"/"` field names** are reserved by DAG-JSON for links/bytes; the editor
  refuses to create them.
- **Big integers** beyond 2^53 may lose precision through the JSON editing
  path (pre-existing blob-editor limitation).
