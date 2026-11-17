---
name: Contract
summary: A tool's contract is the full description of the tool that a model reads, with what it does and the input and output it takes.
---
A **contract** is the full description of one tool, written for the model. It says what the tool does, and it gives the schema of the input and of the output. `read ~/tools/<name>` returns it. For example, `read ~/tools/search` returns the contract of [`search`](./callables.md). <!-- id:zNVN4eE_ -->

A wrong [call](./call.md) also returns the contract, so the model can fix its input. Once a contract is in a thread, the tool is [promoted](./promotion.md): the model gets it as a real tool.

Where a contract comes from, and why it is not always shown:

- A verb's contract comes from the shared registry. Every other tool's contract comes from its [tool document](./tool-document.md).
- The [Space index](./space-index.md) carries only one line for each tool. So the model pays for a full contract only when it needs one.
- The contract a model reads is the one it can call. The [`execute`](./code-execution.md) contract lists only the languages this server can run. A tool the [agent](../agent.md) is not granted reads as missing (see [read](./read.md#tool-contracts)).

# See also <!-- id:m4rOOjIW -->

- [Tool document](./tool-document.md) <!-- id:9dy7ojQr -->
- [Call](./call.md) <!-- id:VMRRI8BU -->
- [Promotion](./promotion.md) <!-- id:J61P10UU -->
- [Space index](./space-index.md) <!-- id:B0OJEPlY -->
- [Tools](./tools.md) <!-- id:0M5tAhs3 -->
- [Agents glossary](./glossary.md) <!-- id:-t6mjRq7 -->
