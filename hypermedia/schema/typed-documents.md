---
name: Typed Documents
summary: How a Hypermedia document declares what it is with the attributesSchema, childAttributesSchema and schemaDefinition fields, with a worked example, the child-inheritance rule and what the editor does with a typed document.
---
# Three fields, three meanings <!-- id:jXvF5E3K -->

A [document's](../protocol/documents.md) metadata may carry up to three schema fields. The base document's [metadata](../metadata.md) declares them, and each one says something different: <!-- id:eKwMrgCU -->

<!-- id:IWXxmzY8 -->
| field <!-- col:Bf70KZPY --> | the sentence it says <!-- col:QNHARA77 --> | value <!-- col:982dpIgh --> <!-- id:bAOtxS8S --> |
| --- | --- | --- |
| `attributesSchema` | "**This** document's attributes follow that schema." | an `hm://` document URL or `ipfs://<cid>` <!-- id:VPaKDU5r --> |
| `childAttributesSchema` | "My **children's** attributes follow that schema." | an `hm://` document URL or `ipfs://<cid>` <!-- id:4Vxh-35k --> |
| `schemaDefinition` | "This document **defines** a schema others can reference." | `ipfs://<cid>` of a schema blob <!-- id:NDbOpl8N --> |

People most often misread the last one. `schemaDefinition` marks a document as the home page of a [schema](../schema.md). A document following a schema uses `attributesSchema`. A document that describes what a person is sets `schemaDefinition`. A document about one person, Bob, sets `attributesSchema` and points it at the person document. A value is never a type. <!-- id:tVwNj-Kz -->

# A worked example <!-- id:SRfoUhma -->

Suppose the Acme [account](../protocol/identity.md) wants person pages. <!-- id:XIl-loiu -->
  1. Acme publishes a schema [blob](../protocol/blobs.md): a [struct](../struct.md) with a required `surname` and an optional `givenName`. The blob has a [CID](../cid.md). <!-- id:tEjNJiAm -->
  2. Acme publishes a readable page at `hm://acme/person` that explains what a person page is, with `schemaDefinition = ipfs://<that cid>`. This page is now the person **type**, and its [`hm://` URL](../protocol/urls.md) names it. <!-- id:Qb0rw8-K -->
  3. Acme publishes `hm://acme/people/bob` with `attributesSchema = hm://acme/person`. The app fetches the person document, follows its `schemaDefinition` to the blob, and learns that Bob's page must carry a `surname`. <!-- id:4DC59tVh -->
  4. Acme sets `childAttributesSchema = hm://acme/person` on `hm://acme/people`. Every child created under it is a person page by default, so nobody has to set `attributesSchema` on each one. <!-- id:wVRUOKV5 -->

The library ships this exact shape as an example. [example/person-doc](../example/person-doc.md) is an attributes schema, and [example/bob](../example/bob.md) is a live instance document whose `attributesSchema` points at its type. <!-- id:fgLcPT4y -->

# The effective schema <!-- id:RaXm1dre -->

One rule decides a document's **effective** attributes schema. It is the document's own `attributesSchema` if it has one, otherwise its parent's `childAttributesSchema`, otherwise none. A child that declares its own `attributesSchema` under a parent with a `childAttributesSchema` must satisfy both. <!-- id:ZMmssRpC -->

This rule types a whole [directory](../protocol/documents.md) without every page repeating the binding. It also lets one page opt out, or opt into something more specific, explicitly. <!-- id:SDKbJneG -->

# An attributes schema is a struct <!-- id:--K0cmG7 -->

An attributes schema is an ordinary struct with one [property](./property.md) per attribute. It says nothing about documents. It does not extend the base [document](../document.md) and never mentions `metadata` or `content`. Here is the person schema from the library, in [dag-json](./dag-json.md): <!-- id:M39usWyk -->

```json <!-- id:5qgOO0Ub -->
{
  "type": "hm://z6MkmZUb…/struct",
  "properties": {
    "surname":   {"value": {"type": "hm://z6MkmZUb…/string"}, "required": true},
    "givenName": {"value": {"type": "hm://z6MkmZUb…/string"}}
  }
}
```

When a document is checked, the base [metadata](../metadata.md) fields are folded in beneath the type's own fields: name, summary, icon and the three binding keys. The result stays open to extra keys. So a typed document is still a full document with a body, [embeds](../protocol/blocks.md), queries and [comments](../protocol/comments.md), and the schema types only its attributes. To build one type on another, [extend](./extension.md) the struct: `example/employee` is `example/person` plus an `employeeId`. <!-- id:XOEf8Rgg -->

# What the editor does with it <!-- id:ECBN6LX9 -->

Once a document has an effective schema, the Seed app changes in four visible ways: <!-- id:SaArwfA0 -->
  - **Required attributes are always present.** Each required field from the resolved schema is a fixed row you cannot remove. It appears at the top of the **Attributes** tab and above the body in the **Content** tab, so a person page cannot lose its surname by accident. <!-- id:byLBE05n -->
  - **Fields get the right control.** A field whose format is a Hypermedia URL renders as a searchable, clickable title pill. A field whose format is an IPFS reference gets a file picker and a file pill. A union of [literals](./literal-schema.md) becomes a dropdown. `attributesSchema` and `childAttributesSchema` are document-reference fields themselves, and `icon`, `cover` and `schemaDefinition` are IPFS-reference fields. <!-- id:hF8BrCL- -->
  - **Problems show in red and never block.** A per-field badge and a summary banner list the actual violations, such as "surname is required" or "status must be one of draft, published, archived". Saving always works, because validation only warns. See [why Hypermedia Schemas](./why.md). <!-- id:lciGA4Bw -->
  - **You edit the schemas on the page.** The **Attributes** tab opens with two sections. **Attributes schema** holds the fields this document carries, and **Children attributes schema** holds the fields every document created inside it carries. Each section shows the full schema editor when the document owns the schema. Edits stay in the [draft](../protocol/documents.md). Publishing freezes each edited schema into a new IPFS object and points the binding key at it. A binding to a type page shows read-only with a link, and **Edit a copy here** takes it over. The options menu entries **Attributes Schema** and **Children Attributes Schema** open the tab on the matching section, and draft an empty struct when nothing is bound yet. So on a folder called Trees, one menu choice and one added field give every tree a `height`. <!-- id:utrc8CYQ -->
  - **A type's home page gets actions.** A document carrying `schemaDefinition` shows a **New Document** button, which starts a draft whose `attributesSchema` is this page. It also shows a **New Collection** button, which starts a draft whose `childAttributesSchema` is this page. So a folder of people is one click from the person type. The options menu adds **Extend Schema** and, for developers, **New Raw Value** (a bare IPFS blob of the type) and **Inspect Schema**. <!-- id:4EmRqGxG -->

# Dates, references and linked objects <!-- id:oDknmQiz -->

Three kinds of field make a typed document work like a record: <!-- id:7vSmoGzD -->
  - **Dates.** [date](../date.md) and [date-time](../date-time.md) are built-in refinements of string. A date is an ISO 8601 `YYYY-MM-DD` calendar date, and a date-time is an RFC 3339 instant. Each has a `pattern`, so a validator can check the shape. The editor shows a **date picker**, and the value on the wire is still the plain string. <!-- id:ihWPLrSf -->
  - **References with a target.** A field whose format is `hm-url` or `ipfs` may carry a `target`: the schema the referenced document or object should conform to. `character.home` targets the Place type, and `character.stats` targets [Character stats](../example/stats.md). A target is advisory, and the validator never dereferences a reference. The editor uses the target to pre-seed and validate what you create. See [references and naming](./references.md). <!-- id:diqJ6BQO -->
  - **Linked objects.** An `ipfs` field can point at an uploaded [file](../protocol/files.md) or at an _object_: a [DAG-CBOR](./dag-cbor.md) value you author in the Attributes editor. Press **Create object** on an empty field. With a target, the editor is locked to that type and publishes only a conforming value. Without one, you pick any schema (advisory) or choose free-form data. The published object carries a `schema` link to its type, the field is set to `ipfs://<cid>`, and the pill offers to open or edit the object. Blobs are immutable, so editing publishes a new object and re-points the field. <!-- id:jlc30xO3 -->

# Doing it yourself <!-- id:lasXj_Va -->

Turn on Developer Mode, then work from any document's options menu: <!-- id:eTXH_hda -->
  1. **New Schema** opens the schema editor. Build the struct of attributes. Publishing mints the blob and gives you an `ipfs://` CID. <!-- id:jpM2R4ld -->
  2. On the page that should be the type's home, set `schemaDefinition` to that CID in the Attributes editor. The page now shows the schema tag and the New Document and New Collection buttons. <!-- id:r5qfTMyI -->
  3. On a page that should be an instance, set `attributesSchema` to the home page's `hm://` URL, or press **New Document** on the type's page. Required fields appear immediately. <!-- id:fTgpB37E -->
  4. On a folder, set `childAttributesSchema` to the same URL to type everything beneath it, or press **New Collection** on the type's page. To type a folder's children without a separate type page, choose **Children Attributes Schema** from the folder's options menu and add the fields there. <!-- id:aKAQIRBf -->

# Pinning or following <!-- id:BboNGJlV -->

A reference by CID pins exact bytes. The type never changes under you, and you must republish to adopt a newer one. A reference by `hm://` URL follows the type's document, which its owner may update. New fields then appear on every instance the next time it opens. The library uses names, so schemas can reference each other in cycles and a type can evolve in place. Choose on purpose: pin when you need a stable contract, and follow when you want the type's owner to improve it. [References and naming](./references.md) covers the versioning trade-off. <!-- id:zgMFP-J0 -->

# See also

- [How Hypermedia Schemas work](./how-it-works.md): the pipeline from schema file to typed document.
- [The World Builder](./world-builder.md): a worked demo of linked types in the app.
- [Metadata](../metadata.md): the base document attributes, including the three binding keys.
- [Documents](../protocol/documents.md): paths, drafts, versions and children.
- [Struct schema](./struct-schema.md) and [property](./property.md): the shape of an attributes schema.
- [Extension](./extension.md): building one type on another.
- [Querying by attribute](../build/query-grammar.md): finding documents by their typed attributes.
