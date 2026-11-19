---
name: Brief
summary: A brief is the task, written in markdown, that an agent gives a model child, and it becomes the child's first message word for word.
---
A **brief** is the task an [agent](../agent.md) gives to a helper, written in markdown. The helper is a model [child](./child.md). The brief becomes the child's first message, word for word. A person can read the brief and know everything the child was told. <!-- id:QF632WRq -->

For example: "Read `hm://…/report` and list every date it mentions. Return the list as bullet points."

A brief is the `brief` field of a [delegate](./delegate.md) call. Other fields of the call shape the child:

- `systemPrompt` (extra instructions);
- `tools` (fewer tools than the parent);
- `model` with `reasoningLevel`;
- `output`, a schema for a [typed result](./typed-result.md).

Write a brief so it stands alone. The child sees the brief, not the parent's conversation. This matters most for a leaf, a child that cannot delegate further: the runtime tells a parent of leaves to give them complete briefs (see [delegation budgets](./delegation-budgets.md)). A detached child (`await: false`) also starts from its brief.

# See also <!-- id:ukSeQ5Hf -->

- [Delegate](./delegate.md) <!-- id:Mw01XtIX -->
- [Child](./child.md) <!-- id:nex7djTA -->
- [Typed result](./typed-result.md) <!-- id:LiCupFL4 -->
- [Delegation budgets](./delegation-budgets.md)
- [What an agent is told](./prompt.md) <!-- id:KqSnp-iI -->
- [Agents glossary](./glossary.md) <!-- id:40Rz1JCp -->
