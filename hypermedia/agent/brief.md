---
name: Brief
summary: A brief is the markdown task description that becomes a model child's first message word for word.
---
A **brief** is the markdown task description that becomes a model [child](./child.md)'s first message, word for word. The person reviews the brief as the child's full context, so the prompt is the interface. <!-- id:QF632WRq -->

A brief is the `brief` field of a [delegate](./delegate.md) call. It travels with optional fields that shape the child: `prompt` (a persona), `tools`, `model` with `reasoningLevel`, and `output` for a [typed result](./typed-result.md). A parent whose children will be leaves is told to write self-contained briefs, because a leaf cannot delegate further (see [delegation budgets](./delegation-budgets.md)). A detached child (`await: false`) also starts from its brief.

# See also <!-- id:ukSeQ5Hf -->

- [Delegate](./delegate.md) <!-- id:Mw01XtIX -->
- [Child](./child.md) <!-- id:nex7djTA -->
- [Typed result](./typed-result.md) <!-- id:LiCupFL4 -->
- [Delegation budgets](./delegation-budgets.md)
- [What an agent is told](./prompt.md) <!-- id:KqSnp-iI -->
- [Agents glossary](./glossary.md) <!-- id:40Rz1JCp -->
