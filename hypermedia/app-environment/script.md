---
name: Script / ctx
summary: A script child is a deterministic JavaScript module whose every effect goes through the journaled ctx object.
---
**script / ctx**: a script [child](./child.md) reaches the outside only through `ctx`: `ctx.call(tool, input, {description})`, `ctx.delegate`, `ctx.parallel`, `ctx.step`, `ctx.plan`, `ctx.sleep`, `ctx.waitForEvent`, `ctx.continueAsNew`. Scripts are deterministic, with no clock and no randomness, and every effect goes into the [journal](./journal.md). See [tools: delegate](./tools.md). <!-- id:FyyJwpqk -->

# See also <!-- id:7VeMo9KX -->

- [Child](./child.md) <!-- id:QJ6FjG-M -->
- [Delegate](./delegate.md) <!-- id:NhYOcamO -->
- [Journal](./journal.md) <!-- id:lzxpzwlS -->
- [continueAsNew](./continue-as-new.md) <!-- id:YeIdOyyv -->
- [Park and wait](./park.md) <!-- id:UIFLluVS -->
- [Tools](./tools.md) <!-- id:S7wYLlwI -->
- [Security: script safety](./security.md) <!-- id:4Gr-aF-2 -->
