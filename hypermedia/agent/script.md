---
name: Script / ctx
summary: A script child is a deterministic JavaScript module whose every effect goes through the journaled ctx object.
---
**script / ctx**: a script child's world: `ctx.call(tool, input, {description})`, `ctx.delegate`, `ctx.parallel`, `ctx.step`, `ctx.plan`, `ctx.sleep`, `ctx.waitForEvent`, `ctx.continueAsNew`. Deterministic: no clock, no randomness, every effect journaled. <!-- id:FyyJwpqk -->
