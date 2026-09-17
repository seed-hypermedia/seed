---
name: Journal
summary: A script run's journal is its durable record of effects, so resuming replays the source and never repeats completed work.
---
**journal**: a [script](./script.md) run's durable record of effects. To resume, the runtime replays the source against the journal, and completed effects never run again. **Narration** (`{description}`) rides on journal entries as display data and is not part of the replay key. The table is `run_journal` in [persistence](./persistence.md). <!-- id:6LiAAWRR -->

# See also

- [Script and ctx](./script.md)
- [continueAsNew](./continue-as-new.md)
- [Runs](./runs.md)
- [Park and wait](./park.md)
- [Persistence](./persistence.md)
- [Security: script safety](./security.md)
