---
name: Typed Documents
summary: A typed document says which schema its attributes follow, using the attributesSchema, childAttributesSchema and schemaDefinition metadata fields.
---
A **typed document** is a [document](../protocol/documents.md) that says which [schema](../schema.md) its attributes follow. A schema is a description of what some data must look like. For example, a page about Bob can say "I am a person page", and the person schema says that every person page has a `surname`.

This page covers the three metadata fields that bind documents to schemas, the rule for getting a type from a folder, and what the [Seed app](../software/desktop.md) does with a typed document.

# Three fields, three meanings <!-- id:jXvF5E3K -->

A document's [metadata](../metadata.md) can carry up to three schema fields. Each one says something different: <!-- id:eKwMrgCU -->

<!-- id:IWXxmzY8 -->
| field <!-- col:Bf70KZPY --> | the sentence it says <!-- col:QNHARA77 --> | value <!-- col:982dpIgh --> <!-- id:bAOtxS8S --> |
| --- | --- | --- |
| `attributesSchema` | "**This** document's attributes follow that schema." | an `hm://` document URL or `ipfs://<cid>` <!-- id:VPaKDU5r --> |
| `childAttributesSchema` | "My **children's** attributes follow that schema." | an `hm://` document URL or `ipfs://<cid>` <!-- id:4Vxh-35k --> |
| `schemaDefinition` | "This document **defines** a schema others can reference." | `ipfs://<cid>` of a schema blob <!-- id:NDbOpl8N --> |

The last field is the easiest to misread. `schemaDefinition` marks a document as the home page of a schema. A document that follows a schema uses `attributesSchema` instead. So: <!-- id:tVwNj-Kz -->
  - A document that describes what a person is sets `schemaDefinition`.
  - A document about one person, Bob, sets `attributesSchema` and points it at the person document.

A value is never a type.

# A worked example <!-- id:SRfoUhma -->

The Acme [account](../protocol/identity.md) wants person pages. It takes four steps. <!-- id:XIl-loiu -->
  1. Acme publishes a schema [blob](../protocol/blobs.md): a [struct](../struct.md) with a required `surname` and an optional `givenName`. The blob has a [CID](../cid.md). <!-- id:tEjNJiAm -->
  2. Acme publishes a page at `hm://acme/person` that explains what a person page is. The page has `schemaDefinition = ipfs://<that cid>`. This page is the person **type**, and its [`hm://` URL](../protocol/urls.md) names it. <!-- id:Qb0rw8-K -->
  3. Acme publishes `hm://acme/people/bob` with `attributesSchema = hm://acme/person`. The app fetches the person document and follows its `schemaDefinition` to the blob. It learns that Bob's page must carry a `surname`. <!-- id:4DC59tVh -->
  4. Acme sets `childAttributesSchema = hm://acme/person` on `hm://acme/people`. Every page created directly under it is a person page. Nobody has to set `attributesSchema` on each one. <!-- id:wVRUOKV5 -->

The library has the pieces. [example/person-doc](../example/person-doc.md) is this attributes schema, with `surname` and `givenName`. [example/bob](../example/bob.md) is a live instance document. Its `attributesSchema` points at another type, [example/employee](../example/employee.md). <!-- id:fgLcPT4y -->

# The effective schema <!-- id:RaXm1dre -->

The **effective** attributes schema of a document is the one schema its attributes are checked against. One rule decides it: <!-- id:ZMmssRpC -->
  1. If the document has its own `attributesSchema`, that is the effective schema.
  2. Otherwise, if its parent has a `childAttributesSchema`, that is the effective schema.
  3. Otherwise the document has no schema.

A child that sets its own `attributesSchema` uses only that schema. The parent's `childAttributesSchema` is then not checked for that child. A folder types only its direct children, not pages deeper down.

With this rule, one field on a folder types every page in that [directory](../protocol/spaces.md). No page has to repeat the binding. A single page can still choose a different type by setting its own `attributesSchema`. <!-- id:SDKbJneG -->

# An attributes schema is a struct <!-- id:--K0cmG7 -->

An attributes schema is an ordinary [struct](../struct.md): a map with named fields. It has one [property](./property.md) per attribute. It says nothing about documents. It does not extend the base [document](../document.md) type, and it never mentions `metadata` or `content`. Here is the person schema from the library, in [dag-json](./dag-json.md): <!-- id:M39usWyk -->

```json <!-- id:5qgOO0Ub -->
{
  "type": "hm://hyper.media/struct",
  "properties": {
    "surname":   {"value": {"type": "hm://hyper.media/string"}, "required": true},
    "givenName": {"value": {"type": "hm://hyper.media/string"}}
  }
}
```

When the app checks a document, it adds the base [metadata](../metadata.md) fields to the type's own fields: name, summary, icon and the three binding keys. Extra keys are still allowed. So a typed document is still a full document with a body, [embeds](../protocol/blocks.md), queries and [comments](../protocol/comments.md). The schema types only its attributes. <!-- id:XOEf8Rgg -->

To build one type on another, [extend](./extension.md) the struct. `example/employee` is `example/person` plus an `employeeId`.

# What the editor does with it <!-- id:ECBN6LX9 -->

When a document has an effective schema, the Seed app does six things: <!-- id:SaArwfA0 -->
  - **Required attributes are always present.** Each required field of the schema is a fixed row that you cannot remove. It appears at the top of the **Attributes** tab and above the body in the **Content** tab. So a person page cannot lose its surname by accident. <!-- id:byLBE05n -->
  - **A new document starts from the defaults.** When a [property](./property.md) has a `default`, a new document of that type gets it as soon as its draft opens: the attribute is written into the draft, shown as a filled row, and yours to change or remove. Only new documents get defaults. A published document is never filled in, so adding a default to a type changes nothing that already exists. <!-- id:dwkiAm7t -->
  - **Fields get the right control.** A field that holds a Hypermedia URL shows as a title pill that you can search and click. When the field names a `target` type, the search lists documents of that type, or of a subtype, first. That includes pages typed by their folder. Other documents follow, and a reference of another type shows a warning. A field that holds an IPFS reference gets a file picker and a file pill. A union of [literals](./literal-schema.md) becomes a dropdown. `attributesSchema` and `childAttributesSchema` are document-reference fields themselves. `icon`, `cover` and `schemaDefinition` are IPFS-reference fields. <!-- id:hF8BrCL- -->
  - **Problems show in red and never block.** A badge on each field and a banner at the top list what does not match, such as "surname is required" or "status must be one of draft, published, archived". Saving always works, because the check only warns. See [the rationale](./why.md). <!-- id:lciGA4Bw -->
  - **You edit the schemas on the page.** The **Attributes** tab has two sections below the attribute rows. **Attributes schema** holds the fields this document carries. **Children attributes schema** holds the fields that every document created inside it carries. What a section shows depends on what is bound: <!-- id:utrc8CYQ -->
    - **Nothing is bound.** Press **Define**. The button reads **Override** when the document inherits a type from its parent. Then search for a type page, or press **Custom Attributes** (or **Custom Children Attributes**) to start an empty struct on this page.
    - **A type page is bound.** The section shows the page as a pill and the schema read-only. Press the ✕ on the pill to clear it.
    - **The document owns the schema.** The section shows the full schema editor and a **Clear** button. Edits stay in the [draft](../protocol/documents.md). Publishing freezes the edited schema into a new IPFS object and points the binding key at it.

    So on a folder called Trees, **Define**, **Custom Children Attributes** and one added field give every tree a `height`.
  - **A type's home page gets actions.** A document that carries `schemaDefinition` for a struct of attributes shows two buttons. **New Document** starts a draft whose `attributesSchema` is this page. **New Collection** starts a draft whose `childAttributesSchema` is this page. So a folder of people is one click from the person type. The options menu adds **Extend Schema**, **New Raw Value** (a bare IPFS blob of the type) and **Inspect Schema**. <!-- id:4EmRqGxG -->

# Dates, references and linked objects <!-- id:oDknmQiz -->

Three kinds of field let a typed document work like a record: <!-- id:7vSmoGzD -->
  - **Dates.** [date](../date.md) and [date-time](../date-time.md) are built-in types that narrow a string. A date is an ISO 8601 `YYYY-MM-DD` calendar date. A date-time is an RFC 3339 point in time. Each has a `pattern`, so a validator can check the shape. The editor shows a **date picker**, and the stored value is still the plain string. <!-- id:ihWPLrSf -->
  - **References with a target.** A field whose format is `hm-url` or `ipfs-url` can carry a `target`. The target is the schema that the referenced document or object should follow. `character.home` targets the Place type, and `character.stats` targets [Character stats](../example/stats.md). A target only advises: the validator never fetches what a reference points at. The editor uses the target to fill in and check what you create. See [references and naming](./references.md). <!-- id:diqJ6BQO -->
  - **Linked objects.** An `ipfs-url` field can point at an uploaded [file](../protocol/files.md) or at an _object_. An object is a [DAG-CBOR](./dag-cbor.md) value that you write in the Attributes editor. Press the **Create linked object** button (the curly braces) on an empty field. With a target, the dialog is locked to that type and publishes only a value that matches it. Without a target, you pick any schema, or you write free-form data. Press **Publish & link**. The published object carries a `schema` link to its type, and the field is set to `ipfs://<cid>`. The pill then offers to open or edit the object. A blob never changes, so editing publishes a new object and points the field at it. <!-- id:jlc30xO3 -->

# Doing it yourself <!-- id:lasXj_Va -->

In the Seed app, these steps set up a type, an instance and a typed folder. [Schema workflows](./workflows.md) has the same tasks for the [CLI](../build/cli.md) and an [agent](../agent.md), and says where the schema menu entries are. <!-- id:eTXH_hda -->
  1. In the inspector's options menu, choose **New Schema**. The schema editor opens. Build the struct of attributes and publish it. Publishing creates the blob and gives you an `ipfs://` CID. <!-- id:jpM2R4ld -->
  2. Open the page that is the type's home. In its **Attributes** tab, set `schemaDefinition` to that CID. The page shows the schema tag and the **New Document** and **New Collection** buttons. <!-- id:r5qfTMyI -->
  3. To make an instance, open a page and set `attributesSchema` to the home page's `hm://` URL. Or press **New Document** on the type's page. The required fields appear at once. <!-- id:fTgpB37E -->
  4. To type a folder, set `childAttributesSchema` on it to the same URL. Or press **New Collection** on the type's page. Every page directly under the folder is then typed. <!-- id:aKAQIRBf -->

To type a folder's children without a separate type page, open the folder's **Attributes** tab, press **Define** under **Children attributes schema**, then **Custom Children Attributes**, and add the fields there.

# Pinning or following <!-- id:BboNGJlV -->

You can bind a type in two ways, and they behave differently: <!-- id:zgMFP-J0 -->
  - **Pin.** A reference by CID (`ipfs://<cid>`) names exact bytes. The type never changes for you. To use a newer one, you publish the document again with the new CID.
  - **Follow.** A reference by `hm://` URL follows the type's document, which its owner can update. New fields then appear on every instance the next time it opens.

The library uses names. That lets schemas reference each other in a circle, and lets a type change in place. Pin when you need a contract that stays the same. Follow when you want the type's owner to improve the type for you. [References and naming](./references.md) explains the choice in full.

# See also <!-- id:oWU3rUEa -->

- [Schema workflows](./workflows.md): each task step by step in the app, the CLI and through an agent. <!-- id:JfaOlasx -->
- [The World Builder](./world-builder.md): a worked demo of linked types in the app. <!-- id:oVtIGDI0 -->
- [Metadata](../metadata.md): the base document attributes, including the three binding keys. <!-- id:bZlgaAck -->
- [Documents](../protocol/documents.md): paths, drafts, versions and children. <!-- id:FNZFTX9J -->
- [Struct schema](./struct-schema.md) and [property](./property.md): the shape of an attributes schema. <!-- id:3MTjxo6H -->
- [Extension](./extension.md): building one type on another. <!-- id:rAW4Et1N -->
- [Querying by attribute](../build/query-grammar.md): finding documents by their typed attributes. <!-- id:XneCBpXU -->
