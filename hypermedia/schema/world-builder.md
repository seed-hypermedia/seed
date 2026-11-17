---
name: World Builder
summary: A worked demo of typed documents, where one menu action builds a small ontology of Characters, Places, Factions and Events whose types reference each other, with dates, links and linked objects on every page.
---
The World Builder is a demo of [typed documents](./typed-documents.md) in the Seed desktop app. One menu action publishes a small ontology of Characters, Places, Factions and Events whose types reference each other. This page describes what it builds and what each page shows.

# What it builds <!-- id:4n7xPiA6 -->

With the Hypermedia Schemas switch on ([schema workflows](./workflows.md) says where it is), a [document](../protocol/documents.md)'s options menu offers **New World…**. Give it a name, a genre and the date its chronicle begins. It then publishes these pages under that document: <!-- id:hMxoClp7 -->

<!-- id:ept4FZO2 -->
| page <!-- col:G2YgYgtP --> | binding <!-- col:5f0PsXQO --> | what you see <!-- col:fhc3ZVh3 --> <!-- id:7k9AXIZN --> |
| --- | --- | --- |
| the world root | `attributesSchema` = [World](../example/world-doc.md) | a genre and an epoch date in Attributes, a card view of everything below <!-- id:wfQles9Y --> |
| `types/character`, `types/place`, `types/faction`, `types/event` | `schemaDefinition` = its schema blob | a type page: a schema tag, **New Document** and **New Collection** buttons, and an editable schema <!-- id:u8IY1F4u --> |
| `characters`, `places`, `factions`, `events` | `childAttributesSchema` = the matching type page | a folder whose pages are typed by inheritance, with a live table of its children <!-- id:14EcwdVE --> |
| one starter page per type | inherited from its folder | required rows already filled: a date picker, title pills pointing at the other starters, and object fields ready to create <!-- id:IBq3SRGz --> |

The kit's [schemas](../schema.md) are the library's [Character](../example/character-doc.md), [Place](../example/place-doc.md), [Faction](../example/faction-doc.md) and [Event](../example/event-doc.md), republished with every `target` rewritten to point at your type pages. A Character's `home` targets `hm://<you>/<world>/types/place` instead of the library's Place. That document does not exist until the same publish creates it. This works because schemas [reference each other by name](./references.md), and a name can point at a page that has no content hash yet. <!-- id:9HXzcmv9 -->

# Editing the ontology <!-- id:s4wjuIUH -->

A type page is a document like any other, so you edit the ontology the way you edit documents. To add a field, open a type's schema. Choose **Date** for a date picker, or choose **HM link** or **IPFS** and fill in a **target type** to point at another type. Every page in the matching folder gains the field. To add a type, publish a new schema-definition page and point a folder's `childAttributesSchema` at it. You never need to delete anything: pages that carry a removed field show a warning until you tidy them. The graph of types is browsable. Each type page links to the types it references, and the explorer shows what depends on what. <!-- id:5M16kAA2 -->

# Walking through a world

The starter pages show each feature of [typed documents](./typed-documents.md) on a real page:
  - **Dates and references.** On a starter character, **born** has a date picker and **home** has a search pill that offers places. <!-- id:lPwOvd5W -->
  - **Linked objects.** **Create object** on **stats** opens a dialog locked to [Character stats](../example/stats.md). It does not publish until strength, intellect and charisma are each from 1 to 10. **notes** has no target, so the same button publishes any value.
  - **Inherited types.** A page added to the Characters folder shows its required rows before you type a word, because the folder's `childAttributesSchema` types it. <!-- id:JpBzBLTu -->
  - **Live types.** Add a Date field to the Character type's schema, and the field appears on every character page. <!-- id:mrZB1SVL -->
  - **A typed root.** In the world root's Attributes, **genre** is a dropdown and **epoch** is a date, because the root conforms to the World type. <!-- id:U2jIiOZP -->

The whole tree is ordinary Hypermedia. You can [sync](../protocol/network.md) it, share it, [comment](../protocol/comments.md) on it, and query it from another [space](../protocol/spaces.md). [Typed documents](./typed-documents.md) explains the model underneath. <!-- id:OMoeBJCw -->

# See also <!-- id:0cizZ2YE -->

- [Typed documents](./typed-documents.md): the three keys that bind a document to a type. <!-- id:OzEiw_oJ -->
- [Schema workflows](./workflows.md): the same features, step by step in the app, the CLI and an agent. <!-- id:Zotapw4E -->
- [References and naming](./references.md): why a `target` can name a page that does not exist yet. <!-- id:Cp4CsWXx -->
- [Schema language](./schema-language.md): the vocabulary the type pages are written in. <!-- id:l_-8A42B -->
- [Metadata](../metadata.md): the built-in keys, including `attributesSchema` and `childAttributesSchema`. <!-- id:BiRzyeVK -->
- [Examples](../example.md): the library's example schemas, including the World kit. <!-- id:OgmaGHH2 -->
