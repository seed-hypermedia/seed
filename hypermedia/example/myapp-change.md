---
name: "Example: MyApp Change"
summary: A Change instantiated with this app's block type — Change<example/app-block>. Because Block is bound, its ReplaceBlock ops are validated strictly against the ap
schemaDefinition: ipfs://bafyreiet3m7qt7jrnumi7oytj7mumpzxhweog33heeynjktse6lzspftii
---
A Change instantiated with this app's block type — Change\<example/app-block>. Because Block is bound, its ReplaceBlock ops are validated strictly against the app's blocks (core + Poll), deep inside the op stack — a block type the app doesn't know is rejected, unlike the open default Change. <!-- id:oQwgI4Kv -->

This document describes the **example/myapp-change** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:LLDru3Us -->

# Shape <!-- id:5RtaMMvP -->

An **instantiation** of the generic [change](../change.md), binding: `Block` = [example/app-block](./app-block.md). <!-- id:opH3cmUc -->

# Depends on <!-- id:vKAY-r3N -->

- [example/app-block](./app-block.md) <!-- id:NIY6gxFu -->
- [change](../change.md) <!-- id:aGdttcAj -->
