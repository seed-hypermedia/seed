---
name: Delegate
summary: The delegate verb spawns a child run, a model child given a brief or a script child given source, and waits for it unless told not to.
---
**delegate**: spawn a [child](./child.md) run. A **model child** gets a [brief](./brief.md), and a **script child** gets a `script` (see [script and ctx](./script.md)). The parent waits for the result unless the call sets `await: false`, which detaches the child. [Tools: delegate](./tools.md) covers models, budgets, and parallel children. <!-- id:heu3gUxG -->

# See also <!-- id:lTv7TOX0 -->

- [Child](./child.md) <!-- id:X5dcRFQ2 -->
- [Brief](./brief.md) <!-- id:Ec7n0onM -->
- [Script and ctx](./script.md) <!-- id:B7cl_JmU -->
- [Typed result](./typed-result.md) <!-- id:28t3rxxP -->
- [Park and wait](./park.md) <!-- id:XBmpV4tW -->
- [Delegation budgets plan](./plans/delegation-budgets.md) <!-- id:uuQlRKAK -->
- [Tools](./tools.md) <!-- id:ZPjXIqBW -->
