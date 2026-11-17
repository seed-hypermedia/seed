---
name: Contract
summary: A tool's contract is its full model-facing specification, the description plus input and output schemas, returned by reading the tool.
---
A **contract** is a tool's full model-facing spec, its description plus its input and output schemas. `read ~/tools/<name>` returns it. A wrong [call](./call.md) also returns it, and once it is in a thread the tool gets [promotion](./promotion.md). <!-- id:zNVN4eE_ -->

A verb's contract comes from the shared registry, and every other tool's contract comes from its [tool document](./tool-document.md). The [Space index](./space-index.md) carries only a one-line summary of each tool, so the model pays for a full contract only when it needs one. The contract a model reads is the one it can call: the `execute` contract is narrowed to the runtimes the server can run, and a tool the agent is not granted reads as missing (see [read](./read.md#tool-contracts)).

# See also <!-- id:m4rOOjIW -->

- [Tool document](./tool-document.md) <!-- id:9dy7ojQr -->
- [Call](./call.md) <!-- id:VMRRI8BU -->
- [Promotion](./promotion.md) <!-- id:J61P10UU -->
- [Space index](./space-index.md) <!-- id:B0OJEPlY -->
- [Tools](./tools.md) <!-- id:0M5tAhs3 -->
- [Agents glossary](./glossary.md) <!-- id:-t6mjRq7 -->
