---
name: continueAsNew
summary: continueAsNew lets a long-running script finish into a fresh successor run in the same place, so a day-scale loop never grows an unbounded journal.
---
**continueAsNew** lets a long-running [script](./script.md) end and start a fresh successor [run](./runs.md) in the same place, with the same parent and the same call, but with a clean [journal](./journal.md). This keeps day-long loops from growing an unbounded journal. The `continued_from_run_id` column in [persistence](../operate/persistence.md) links the two runs. <!-- id:Pzf6wvlO -->

A script calls it as `ctx.continueAsNew`, and the call never resolves: the current run ends there. A journal has a size budget, and a run that outgrows it fails with `journal-cap`, so a loop meant to run for days should hand over before that. It is not [session continuation](./session-continuation.md), which carries a conversation into a new session.

# See also <!-- id:LUj1XDtR -->

- [Script and ctx](./script.md) <!-- id:otzjofHe -->
- [Journal](./journal.md) <!-- id:Y7Ay4SpS -->
- [Runs](./runs.md) <!-- id:moefndBo -->
- [Park and wait](./park.md) <!-- id:wGdXzbDD -->
- [Session continuation](./session-continuation.md) <!-- id:ZwjqfbJO -->
- [Persistence](../operate/persistence.md) <!-- id:P4IBYgnf -->
