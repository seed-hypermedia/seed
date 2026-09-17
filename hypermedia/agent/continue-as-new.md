---
name: continueAsNew
summary: continueAsNew lets a long-running script finish into a fresh successor run in the same place, so a day-scale loop never grows an unbounded journal.
---
**continueAsNew**: a long-running [script](./script.md) ends and starts a fresh successor [run](./runs.md) in the same place, with the same parent and the same call, but with a clean [journal](./journal.md). This keeps day-long loops from growing an unbounded journal. The `continued_from_run_id` column in [persistence](./persistence.md) links the two runs. <!-- id:Pzf6wvlO -->

# See also

- [Script and ctx](./script.md)
- [Journal](./journal.md)
- [Runs](./runs.md)
- [Park and wait](./park.md)
- [Session continuation](./session-continuation.md)
- [Persistence](./persistence.md)
