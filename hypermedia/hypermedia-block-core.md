---
name: Core block
summary: The union of the fifteen built-in block types (Paragraph, Heading, Code, Math, Image, Video, File, Button, Embed, WebEmbed, Nostr, Table, TableRow, TableColumn,
schemaDefinition: ipfs://bafyreiebo2r3xrbwxdnz4xzc6yxva7wggtbjtdrlzxuw7etqarauqaucjq
---
The union of the fifteen built-in block types (Paragraph, Heading, Code, Math, Image, Video, File, Button, Embed, WebEmbed, Nostr, Table, TableRow, TableColumn, Query). This is the strict core Hypermedia defines; anyone can extend it by making a larger union that includes it plus their own block types. <!-- id:38pY0Ovx -->

This document describes the **hypermedia-block-core** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:MKlfmMqt -->

# Shape <!-- id:3vJCYHye -->
A **union** — a value matches one of these variants: <!-- id:k29A1dG- -->
  - [hypermedia-block-paragraph](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-paragraph) <!-- id:fW1wQHLx -->
  - [hypermedia-block-heading](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-heading) <!-- id:75e1rNp2 -->
  - [hypermedia-block-code](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-code) <!-- id:7Ec0B_-v -->
  - [hypermedia-block-math](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-math) <!-- id:QDycSCAv -->
  - [hypermedia-block-image](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-image) <!-- id:x4aS8q5D -->
  - [hypermedia-block-video](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-video) <!-- id:TvkBIH9a -->
  - [hypermedia-block-file](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-file) <!-- id:wwjUU6fC -->
  - [hypermedia-block-button](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-button) <!-- id:sb8WZ95W -->
  - [hypermedia-block-embed](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-embed) <!-- id:KJCJBVDD -->
  - [hypermedia-block-web-embed](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-web-embed) <!-- id:ABQQB7N2 -->
  - [hypermedia-block-nostr](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-nostr) <!-- id:6ExFE8P8 -->
  - [hypermedia-block-table](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-table) <!-- id:-L7Iz0oX -->
  - [hypermedia-block-table-row](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-table-row) <!-- id:yOaWDqYC -->
  - [hypermedia-block-table-column](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-table-column) <!-- id:ljw-Ub92 -->
  - [hypermedia-block-query](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-query) <!-- id:9J2S1IJf -->

# Depends on <!-- id:JBcAio2a -->
- [hypermedia-block-button](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-button) <!-- id:95PkR0Va -->
- [hypermedia-block-code](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-code) <!-- id:DoP-3lbb -->
- [hypermedia-block-embed](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-embed) <!-- id:UfVtGs18 -->
- [hypermedia-block-file](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-file) <!-- id:Ow6Vn6_c -->
- [hypermedia-block-heading](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-heading) <!-- id:meGTMyiV -->
- [hypermedia-block-image](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-image) <!-- id:doCZBWWs -->
- [hypermedia-block-math](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-math) <!-- id:0MMgVlyZ -->
- [hypermedia-block-nostr](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-nostr) <!-- id:SI8QCc3A -->
- [hypermedia-block-paragraph](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-paragraph) <!-- id:W3kzTSxB -->
- [hypermedia-block-query](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-query) <!-- id:WrG0RsBf -->
- [hypermedia-block-table](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-table) <!-- id:HSmtp1t4 -->
- [hypermedia-block-table-column](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-table-column) <!-- id:PrKyJUKP -->
- [hypermedia-block-table-row](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-table-row) <!-- id:JeH5fZ83 -->
- [hypermedia-block-video](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-video) <!-- id:ZxfdkwxA -->
- [hypermedia-block-web-embed](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-web-embed) <!-- id:yFyvlYFu -->