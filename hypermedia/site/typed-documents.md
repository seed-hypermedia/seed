---
name: Typed Documents
summary: How a Hypermedia document declares what it is — the schema, childrenSchema, and schemaDefinition fields — with a worked example, the child-inheritance rule, and what the editor does with a typed document.
---
# Three fields, three different sentences <!-- id:jXvF5E3K -->
Every document's metadata may carry up to three schema-related fields. They are declared on the base document schema, [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata), and each one says a different thing: <!-- id:eKwMrgCU -->

<!-- id:IWXxmzY8 -->
| field <!-- col:Bf70KZPY --> | the sentence it says <!-- col:QNHARA77 --> | value <!-- col:982dpIgh --> <!-- id:bAOtxS8S --> |
| --- | --- | --- |
| `schema` | "**This** document conforms to that type." | an `hm://` document URL or `ipfs://<cid>` <!-- id:VPaKDU5r --> |
| `childrenSchema` | "My **children** must conform to that type." | an `hm://` document URL or `ipfs://<cid>` <!-- id:4Vxh-35k --> |
| `schemaDefinition` | "This document **defines** a type others can reference." | `ipfs://<cid>` of a schema blob <!-- id:NDbOpl8N --> |

The one that trips people up is the last. `schemaDefinition` does **not** mean "this document follows a schema." It means "this document _is the home page of_ a schema." A document that describes what a person is sets `schemaDefinition`. A document about a particular person — Bob — sets `schema`, pointing at the person document. A value is never a type. <!-- id:tVwNj-Kz -->

# A worked example <!-- id:SRfoUhma -->
Suppose the Acme account wants person pages. <!-- id:XIl-loiu -->
  1. Acme publishes a schema blob. It extends the base document, [hypermedia-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-document), and requires a `surname` in `metadata`. The blob has a CID. <!-- id:tEjNJiAm -->
  2. Acme publishes a document at `hm://acme/person` — a readable page explaining what a person page is — with `schemaDefinition = ipfs://<that cid>`. This is now the person **type**, addressable by name. <!-- id:Qb0rw8-K -->
  3. Acme publishes `hm://acme/people/bob` with `schema = hm://acme/person`. The app fetches the person document, follows its `schemaDefinition` to the blob, and now knows Bob's page must carry a `surname`. <!-- id:4DC59tVh -->
  4. Acme sets `childrenSchema = hm://acme/person` on `hm://acme/people`. Every child created under it is a person page by default; nobody has to remember to set `schema` on each one. <!-- id:wVRUOKV5 -->

The library ships this exact shape as an example: [example-person-doc](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-person-doc) is a typed document schema that refines `metadata`, and [example-bob](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-bob) is a live instance document whose `schema` points at its type. <!-- id:fgLcPT4y -->

# The effective schema <!-- id:RaXm1dre -->
A document's **effective** conformance schema is decided by one rule: its own `schema` if it has one, otherwise its parent's `childrenSchema`, otherwise none. A child that declares its own `schema` while its parent declares a `childrenSchema` is expected to satisfy both — and, like every typed document, to descend from the base document. <!-- id:ZMmssRpC -->

This is what makes a directory typed without making every page repeat itself, and what lets one page opt out (or into something more specific) explicitly. <!-- id:SDKbJneG -->

# Extending the base document <!-- id:--K0cmG7 -->
A typed document schema is an ordinary Onyx extension. It references the base document and refines the nested `metadata` — adding properties, marking some required — and may constrain `content` too. Here is the shape of the person-document schema from the library, in dag-json: <!-- id:M39usWyk -->

```json <!-- id:5qgOO0Ub -->
{
  "ref": "hm://z6MkmZUb…/hypermedia-document",
  "properties": {
    "metadata": {
      "ref": "hm://z6MkmZUb…/hypermedia-metadata",
      "required": ["surname"],
      "properties": {
        "surname":   {"ref": "hm://z6MkmZUb…/string"},
        "givenName": {"ref": "hm://z6MkmZUb…/string"}
      }
    }
  }
}
```

Because the base is [hypermedia-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-document) — `{ metadata, content }` where `content` is the block tree — a typed document is still a full document with a body, embeds, queries, and comments. Typing adds structure to a page; it never takes the page away. Extension semantics are described in [the schema language](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema-language). <!-- id:XOEf8Rgg -->

# What the editor does with it <!-- id:ECBN6LX9 -->
Once a document has an effective schema, the Seed app changes in four visible ways: <!-- id:SaArwfA0 -->
  - **Required attributes are always present.** Each required field from the resolved schema is a fixed, non-removable row — at the top of the **Attributes** tab and above the body in the **Content** tab — so a person page can never quietly lose its surname. <!-- id:byLBE05n -->
  - **Fields get the right control.** A field whose format is a Hypermedia URL renders as a searchable, clickable title pill rather than a raw string. A field whose format is an IPFS reference gets a file picker and a file pill. Enums become dropdowns. `schema` and `childrenSchema` are themselves document-reference fields; `icon`, `cover`, and `schemaDefinition` are IPFS-reference fields. <!-- id:hF8BrCL- -->
  - **Problems are shown in red and never block.** A per-field badge and a summary banner list the actual violations — "surname is required", "status must be one of draft, published, archived". Saving always works. Validation is a guardrail, not a gate; see [why Onyx](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/why). <!-- id:lciGA4Bw -->
  - **A type's home page gets actions.** A document carrying `schemaDefinition` shows a header tag that opens the schema in the explorer and a **Create** button that opens a value editor for that type and publishes a new conforming document — one whose `schema` is this page's URL. <!-- id:4EmRqGxG -->

# Dates, references, and linked objects <!-- id:oDknmQiz -->
Three kinds of field make a typed document feel like a record rather than a bag of text: <!-- id:7vSmoGzD -->
  - **Dates.** [date](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/date) and [date-time](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/date-time) are built-in refinements of string — an ISO 8601 `YYYY-MM-DD` calendar date and an RFC 3339 instant — with a `pattern` so a validator can check the shape. In the editor a date field is a **date picker**; the value on the wire is still the plain string. <!-- id:ihWPLrSf -->
  - **References with a target.** A field whose format is `hm-url` or `ipfs` may carry a `target`: the schema the referenced document or object is expected to conform to. `character.home` targets the Place type; `character.stats` targets [Character stats](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-stats). A target is advisory — the validator never dereferences a reference — but the editor uses it to pre-seed and validate what you create. <!-- id:diqJ6BQO -->
  - **Linked objects.** An `ipfs` field can point at a _file_ (uploaded) or at an _object_ — a DAG-CBOR value authored right in the Attributes editor. Press **Create object** on an empty field: with a target, the editor is locked to that type and publishes only a conforming value; without one, pick any schema (advisory) or choose free-form data. The published object carries a `schema` link to its type, the field is set to `ipfs://<cid>`, and the pill offers to open or edit it. Editing publishes a new version and re-points the field, because blobs are immutable. <!-- id:jlc30xO3 -->

# Doing it yourself <!-- id:lasXj_Va -->
With Developer Mode on, from any document's options menu: <!-- id:eTXH_hda -->
  1. **New Schema** opens the schema editor. Build the type — or start from the base document to make a typed _document_ schema. Publishing mints the blob and gives you an `ipfs://` CID. <!-- id:jpM2R4ld -->
  2. On the page that should be the type's home, set `schemaDefinition` to that CID in the Attributes editor. The page now shows the schema tag and the Create button. <!-- id:r5qfTMyI -->
  3. On a page that should be an instance, set `schema` to the home page's `hm://` URL — or press **Create** on the type's page. Required fields appear immediately. <!-- id:fTgpB37E -->
  4. On a folder, set `childrenSchema` to the same URL to type everything beneath it. <!-- id:aKAQIRBf -->

# Pinning versus following <!-- id:BboNGJlV -->
A reference by CID pins exact bytes: the type can never change under you, and you must republish to adopt a newer one. A reference by `hm://` URL follows the type's document, which the owner may update — new fields appear on every instance the next time it is opened. Both are legitimate; the library uses names so that schemas can reference each other in cycles and so that a type can evolve in place. The choice should be deliberate: pin when you need a stable contract, follow when you want the type's owner to be able to improve it. The versioning trade-off is discussed further in [references & naming](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/references). <!-- id:zgMFP-J0 -->