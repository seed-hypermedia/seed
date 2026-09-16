---
name: Typed Documents
summary: How a Hypermedia document declares what it is — the attributesSchema, childAttributesSchema, and schemaDefinition fields — with a worked example, the child-inheritance rule, and what the editor does with a typed document.
---
# Three fields, three different sentences <!-- id:jXvF5E3K -->

Every document's metadata may carry up to three schema-related fields. They are declared on the base document's [metadata](../metadata.md), and each one says a different thing: <!-- id:eKwMrgCU -->

<!-- id:IWXxmzY8 -->
| field <!-- col:Bf70KZPY --> | the sentence it says <!-- col:QNHARA77 --> | value <!-- col:982dpIgh --> <!-- id:bAOtxS8S --> |
| --- | --- | --- |
| `attributesSchema` | "**This** document's attributes follow that schema." | an `hm://` document URL or `ipfs://<cid>` <!-- id:VPaKDU5r --> |
| `childAttributesSchema` | "My **children's** attributes follow that schema." | an `hm://` document URL or `ipfs://<cid>` <!-- id:4Vxh-35k --> |
| `schemaDefinition` | "This document **defines** a schema others can reference." | `ipfs://<cid>` of a schema blob <!-- id:NDbOpl8N --> |

The one that trips people up is the last. `schemaDefinition` does **not** mean "this document follows a schema." It means "this document _is the home page of_ a schema." A document that describes what a person is sets `schemaDefinition`. A document about a particular person — Bob — sets `attributesSchema`, pointing at the person document. A value is never a type. <!-- id:tVwNj-Kz -->

# A worked example <!-- id:SRfoUhma -->

Suppose the Acme account wants person pages. <!-- id:XIl-loiu -->
  1. Acme publishes a schema blob: a [struct](../struct.md) with a required `surname` and an optional `givenName`. The blob has a CID. <!-- id:tEjNJiAm -->
  2. Acme publishes a document at `hm://acme/person` — a readable page explaining what a person page is — with `schemaDefinition = ipfs://<that cid>`. This is now the person **type**, addressable by name. <!-- id:Qb0rw8-K -->
  3. Acme publishes `hm://acme/people/bob` with `attributesSchema = hm://acme/person`. The app fetches the person document, follows its `schemaDefinition` to the blob, and now knows Bob's page must carry a `surname`. <!-- id:4DC59tVh -->
  4. Acme sets `childAttributesSchema = hm://acme/person` on `hm://acme/people`. Every child created under it is a person page by default; nobody has to remember to set `attributesSchema` on each one. <!-- id:wVRUOKV5 -->

The library ships this exact shape as an example: [example/person-doc](../example/person-doc.md) is an attributes schema, and [example/bob](../example/bob.md) is a live instance document whose `attributesSchema` points at its type. <!-- id:fgLcPT4y -->

# The effective schema <!-- id:RaXm1dre -->

A document's **effective** attributes schema is decided by one rule: its own `attributesSchema` if it has one, otherwise its parent's `childAttributesSchema`, otherwise none. A child that declares its own `attributesSchema` while its parent declares a `childAttributesSchema` is expected to satisfy both. <!-- id:ZMmssRpC -->

This is what makes a directory typed without making every page repeat itself, and what lets one page opt out (or into something more specific) explicitly. <!-- id:SDKbJneG -->

# An attributes schema is a struct <!-- id:--K0cmG7 -->

An attributes schema is an ordinary struct: one [property](./property.md) per attribute, nothing about documents. It does not extend the base [document](../document.md) and never mentions `metadata` or `content`. Here is the person schema from the library, in dag-json: <!-- id:M39usWyk -->

```json <!-- id:5qgOO0Ub -->
{
  "type": "hm://z6MkmZUb…/struct",
  "properties": {
    "surname":   {"value": {"type": "hm://z6MkmZUb…/string"}, "required": true},
    "givenName": {"value": {"type": "hm://z6MkmZUb…/string"}}
  }
}
```

When a document is checked, the base [metadata](../metadata.md) fields — name, summary, icon, the three binding keys — are folded in beneath the type's own fields, and the result is kept open to extra keys. So a typed document is still a full document with a body, embeds, queries, and comments; the schema only types its attributes. Typing adds structure to a page; it never takes the page away. To build one type on another, [extend](./extension.md) the struct: `example/employee` is `example/person` plus an `employeeId`. <!-- id:XOEf8Rgg -->

# What the editor does with it <!-- id:ECBN6LX9 -->

Once a document has an effective schema, the Seed app changes in four visible ways: <!-- id:SaArwfA0 -->
  - **Required attributes are always present.** Each required field from the resolved schema is a fixed, non-removable row — at the top of the **Attributes** tab and above the body in the **Content** tab — so a person page can never quietly lose its surname. <!-- id:byLBE05n -->
  - **Fields get the right control.** A field whose format is a Hypermedia URL renders as a searchable, clickable title pill rather than a raw string. A field whose format is an IPFS reference gets a file picker and a file pill. A union of literals becomes a dropdown. `attributesSchema` and `childAttributesSchema` are themselves document-reference fields; `icon`, `cover`, and `schemaDefinition` are IPFS-reference fields. <!-- id:hF8BrCL- -->
  - **Problems are shown in red and never block.** A per-field badge and a summary banner list the actual violations — "surname is required", "status must be one of draft, published, archived". Saving always works. Validation is a guardrail, not a gate; see [why Hypermedia Schemas](../doc/schema/why.md). <!-- id:lciGA4Bw -->
  - **The schemas are edited on the page.** The **Attributes** tab opens with two sections, **Attributes schema** (the fields this document carries) and **Children attributes schema** (the fields every document created inside it carries), each showing the full schema editor when the document owns the schema. Edits stay in the draft; publishing freezes each edited schema into a new IPFS object and points the binding key at it. A binding to a type page is shown read-only with a link, and **Edit a copy here** takes it over. The options menu's **Attributes Schema** and **Children Attributes Schema** entries open the tab on the right section, drafting an empty struct when nothing is bound yet — so on a folder called Trees, one menu choice and one added field gives every tree a `height`. <!-- id:utrc8CYQ -->
  - **A type's home page gets actions.** A document carrying `schemaDefinition` shows a **New Document** button, which starts a draft whose `attributesSchema` is this page, and a **New Collection** button, which starts a draft whose `childAttributesSchema` is this page — so a folder of people is one click from the person type. The options menu adds **Extend Schema** and, for developers, **New Raw Value** (a bare IPFS blob of the type) and **Inspect Schema**. <!-- id:4EmRqGxG -->

# Dates, references, and linked objects <!-- id:oDknmQiz -->

Three kinds of field make a typed document feel like a record rather than a bag of text: <!-- id:7vSmoGzD -->
  - **Dates.** [date](../date.md) and [date-time](../date-time.md) are built-in refinements of string — an ISO 8601 `YYYY-MM-DD` calendar date and an RFC 3339 instant — with a `pattern` so a validator can check the shape. In the editor a date field is a **date picker**; the value on the wire is still the plain string. <!-- id:ihWPLrSf -->
  - **References with a target.** A field whose format is `hm-url` or `ipfs` may carry a `target`: the schema the referenced document or object is expected to conform to. `character.home` targets the Place type; `character.stats` targets [Character stats](../example/stats.md). A target is advisory — the validator never dereferences a reference — but the editor uses it to pre-seed and validate what you create. <!-- id:diqJ6BQO -->
  - **Linked objects.** An `ipfs` field can point at a _file_ (uploaded) or at an _object_ — a DAG-CBOR value authored right in the Attributes editor. Press **Create object** on an empty field: with a target, the editor is locked to that type and publishes only a conforming value; without one, pick any schema (advisory) or choose free-form data. The published object carries a `schema` link to its type, the field is set to `ipfs://<cid>`, and the pill offers to open or edit it. Editing publishes a new version and re-points the field, because blobs are immutable. <!-- id:jlc30xO3 -->

# Doing it yourself <!-- id:lasXj_Va -->

With Developer Mode on, from any document's options menu: <!-- id:eTXH_hda -->
  1. **New Schema** opens the schema editor. Build the struct of attributes. Publishing mints the blob and gives you an `ipfs://` CID. <!-- id:jpM2R4ld -->
  2. On the page that should be the type's home, set `schemaDefinition` to that CID in the Attributes editor. The page now shows the schema tag and the New Document and New Collection buttons. <!-- id:r5qfTMyI -->
  3. On a page that should be an instance, set `attributesSchema` to the home page's `hm://` URL — or press **New Document** on the type's page. Required fields appear immediately. <!-- id:fTgpB37E -->
  4. On a folder, set `childAttributesSchema` to the same URL to type everything beneath it — or press **New Collection** on the type's page. To type a folder's children without a separate type page, choose **Children Attributes Schema** from the folder's options menu and add the fields right there. <!-- id:aKAQIRBf -->

# Pinning versus following <!-- id:BboNGJlV -->

A reference by CID pins exact bytes: the type can never change under you, and you must republish to adopt a newer one. A reference by `hm://` URL follows the type's document, which the owner may update — new fields appear on every instance the next time it is opened. Both are legitimate; the library uses names so that schemas can reference each other in cycles and so that a type can evolve in place. The choice should be deliberate: pin when you need a stable contract, follow when you want the type's owner to be able to improve it. The versioning trade-off is discussed further in [references & naming](./references.md). <!-- id:zgMFP-J0 -->
