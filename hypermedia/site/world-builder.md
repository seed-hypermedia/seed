---
name: The World Builder
summary: A worked demonstration of typed documents — one menu action scaffolds a small ontology of Characters, Places, Factions, and Events whose types reference each other, with dates, links, and linked objects in every page.
---
# What it builds <!-- id:4n7xPiA6 -->
With Developer Mode on, a document's options menu offers **New World…**. Give it a name, a genre, and the date its chronicle begins, and it publishes, under that document: <!-- id:hMxoClp7 -->

<!-- id:ept4FZO2 -->
| page <!-- col:G2YgYgtP --> | binding <!-- col:5f0PsXQO --> | what you see <!-- col:fhc3ZVh3 --> <!-- id:7k9AXIZN --> |
| --- | --- | --- |
| the world root | `schema` = [World](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-world-doc) | a genre and an epoch date in Attributes, a card view of everything below <!-- id:wfQles9Y --> |
| `types/character`, `types/place`, `types/faction`, `types/event` | `schemaDefinition` = its schema blob | a type page: a schema tag, a **Create** button, and an editable schema <!-- id:u8IY1F4u --> |
| `characters`, `places`, `factions`, `events` | `childrenSchema` = the matching type page | a folder whose pages are typed by inheritance, with a live table of its children <!-- id:14EcwdVE --> |
| one starter page per type | inherited from its folder | required rows already filled: a date picker, title pills pointing at the other starters, and object fields ready to create <!-- id:IBq3SRGz --> |

The kit's schemas are the library's [Character](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-character-doc), [Place](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-place-doc), [Faction](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-faction-doc), and [Event](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-event-doc) — republished with every `target` rewritten to point at _your_ type pages. A Character's `home` no longer targets the library's Place; it targets `hm://<you>/<world>/types/place`, a document that does not exist until the same publish creates it. Names, not hashes, are what make that possible. <!-- id:9HXzcmv9 -->

# Why it is an ontology editor <!-- id:s4wjuIUH -->
A type page is a document like any other, so the ontology is edited the way documents are edited. Open a type's schema to add a field — choose **Date** for a date picker, or **HM link** / **IPFS** and fill in a **target type** to point at another type — and every page in the matching folder gains the field. Add a new type by publishing a new schema-definition page and pointing a folder's `childrenSchema` at it. Delete nothing: pages that carried a removed field simply show a warning until you tidy them. The graph of types is browsable — each type page links to the types it references, and the explorer shows what depends on what. <!-- id:5M16kAA2 -->

# What to try <!-- id:zCiMeuhy -->
<!-- id:oXiYi7ao -->
1. Open the Wanderer. In Attributes, change **born** with the picker, pick a different **home** with the search pill, and press **Create object** on **stats** — the dialog is locked to Character stats and will not publish until strength, intellect, and charisma are within 1–10. Then press it on **notes** and publish anything at all. <!-- id:lPwOvd5W -->
2. Open the Characters folder and add a page. The required rows appear before you type a word, because the folder's `childrenSchema` types it. <!-- id:JpBzBLTu -->
3. Open the Character type, edit its schema, and add a `title` Date field. Go back to the Wanderer: the new field is there. <!-- id:mrZB1SVL -->
4. Open the world root's Attributes: **genre** is a dropdown and **epoch** is a date, because the root conforms to the World type. <!-- id:U2jIiOZP -->

The whole tree is ordinary Hypermedia: sync it, share it, comment on it, query it from another space. See [typed documents](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/typed-documents) for the model underneath. <!-- id:OMoeBJCw -->