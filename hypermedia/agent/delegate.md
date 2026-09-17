---
name: Delegate
summary: The delegate verb spawns a child run, a model child given a brief or a script child given source, and waits for it unless told not to.
---
**delegate**: spawn a [child](./child.md) run. A **model child** gets a [brief](./brief.md), and a **script child** gets a `script` (see [script and ctx](./script.md)). The parent waits for the result unless the call sets `await: false`, which detaches the child. [Tools: delegate](./tools.md) covers models, budgets, and parallel children. <!-- id:heu3gUxG -->

# See also

- [Child](./child.md)
- [Brief](./brief.md)
- [Script and ctx](./script.md)
- [Typed result](./typed-result.md)
- [Park and wait](./park.md)
- [Delegation budgets plan](./plans/delegation-budgets.md)
- [Tools](./tools.md)
