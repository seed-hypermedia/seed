---
name: continueAsNew
summary: continueAsNew lets a long-running script end and start a fresh run in the same place, so a loop that runs for days never fills its journal.
---
**continueAsNew** lets a long-running [script](./script.md) end and start again as a fresh [run](./runs.md). The new run takes the same place: the same parent and the same call. But it starts with an empty [journal](./journal.md), the saved record of what a script did. <!-- id:Pzf6wvlO -->

For example, a script that checks a feed every hour can call `ctx.continueAsNew` once a day. Each day is then its own run with a short journal.

- A script calls it as `ctx.continueAsNew`. The call never resolves: the run ends there.
- A journal holds at most 5,000 entries or 8 MiB. A run that goes past that fails with `journal-cap`. So a loop meant to run for days should hand over before the limit.
- The `continued_from_run_id` column in [persistence](../operate/persistence.md) links the two runs.

It is not [session continuation](./session-continuation.md), which carries a conversation into a new [session](./session.md).

# See also <!-- id:LUj1XDtR -->

- [Script and ctx](./script.md) <!-- id:otzjofHe -->
- [Journal](./journal.md) <!-- id:Y7Ay4SpS -->
- [Runs](./runs.md) <!-- id:moefndBo -->
- [Park and wait](./park.md) <!-- id:wGdXzbDD -->
- [Session continuation](./session-continuation.md) <!-- id:ZwjqfbJO -->
- [Persistence](../operate/persistence.md) <!-- id:P4IBYgnf -->
