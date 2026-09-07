---
name: Math block
summary: A block of LaTeX/KaTeX math.
schemaDefinition: ipfs://bafyreiah7r45un7nadavcoyt7pm2mydxcvefxinnsvupch62dbbnbxnm2m
---
This document describes the **hypermedia-block-math** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:usrj-I7W -->

# Shape <!-- id:aWWfkPD5 -->

**Extends** [hypermedia-block-base](./hypermedia-block-base.md) with these added fields: <!-- id:SBltfmzC -->
  - `type` — `string` enum: `Math` <!-- id:svQxxVDN -->
  - `text` — [string](./hypermedia-string.md) <!-- id:Fn40dsDZ -->
  - `attributes` — map { 2 fields } <!-- id:9xuaTSwI -->

# Depends on <!-- id:2UNOf9xM -->

- [hypermedia-block-base](./hypermedia-block-base.md) <!-- id:LayK8q5D -->
- [hypermedia-children-type](./hypermedia-children-type.md) <!-- id:nMsh63jO -->
- [any](./hypermedia-any.md) <!-- id:Pte3s6Aa -->
- [float](./hypermedia-float.md) <!-- id:iP9RpaYy -->
- [string](./hypermedia-string.md) <!-- id:CfYrEM4W -->
