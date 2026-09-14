---
name: HM link
summary: "A reference to a Hypermedia document, held as an `hm://` URL string. `format: hm-url` tells an editor to render it as a searchable reference that displays the t"
schemaDefinition: ipfs://bafyreicnzwaxpptqcxkqdfibs6sxjztqbmo3acukiblv47ugmjumva7cee
---
**`hm://` URL** — a **name reference**: how one schema points at another (`hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema/string`). A name is independent of content, so — unlike a CID — names can form cycles, which is what makes recursion expressible. Local filenames are the dev alias (`schema/string` ⇄ `hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema/string`). <!-- id:yKu5YAX1 -->

A reference to a Hypermedia document, held as an `hm://` URL string. `format: hm-url` tells an editor to render it as a searchable reference that displays the target's title (a pill), not the raw URL. <!-- id:9OE_xwGa -->

This document describes the **hm-url** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:G6hl5zLM -->

# Shape <!-- id:H_xRODWw -->

Kind: `string`. <!-- id:jtyGQxC6 -->
