---
name: "Example: MyApp Change"
summary: "A Change instantiated with the app’s block type, so its ReplaceBlock ops are validated strictly against core blocks plus Poll instead of the open default."
schemaDefinition: ipfs://bafyreibxyggij45co4l7sbh3r7lwltedccisohja6xc2pjljhdd2x45bze
---
A [Change](../change.md) bound to this app's block type: `Change<example/app-block>`. It instantiates the [generic](../schema/generic.md) Change with `Block` set to [app-block](./app-block.md). Its [ReplaceBlock](../change/op/replace-block.md) ops are checked strictly against the app's blocks, core plus Poll, deep inside the op stack. A block type the app does not know is rejected. The default Change is open and accepts it. <!-- id:oQwgI4Kv -->

This page describes the **example/myapp-change** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:LLDru3Us -->

# Shape <!-- id:5RtaMMvP -->

An **instantiation** of the generic [change](../change.md), binding: `Block` = [example/app-block](./app-block.md). <!-- id:opH3cmUc -->

# Depends on <!-- id:vKAY-r3N -->

- [example/app-block](./app-block.md) <!-- id:NIY6gxFu -->
- [change](../change.md) <!-- id:aGdttcAj -->

# See also

- [app-block](./app-block.md): the block union it binds.
- [Generic](../schema/generic.md): schemas parameterized over a type.
- [Change](../change.md): the generic Change blob.
- [Examples](../example.md): every example, grouped by feature.
