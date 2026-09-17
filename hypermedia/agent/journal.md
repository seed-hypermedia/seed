---
name: Journal
summary: A script run's journal is its durable record of effects, so resuming replays the source and never repeats completed work.
---
**journal**: a [script](./script.md) run's durable record of effects. To resume, the runtime replays the source against the journal, and completed effects never run again. **Narration** (`{description}`) rides on journal entries as display data and is not part of the replay key. The table is `run_journal` in [persistence](./persistence.md). <!-- id:6LiAAWRR -->

# See also <!-- id:uVsdCKl5 -->

- [Script and ctx](./script.md) <!-- id:Po3RN5IJ -->
- [continueAsNew](./continue-as-new.md) <!-- id:jwZOmfWJ -->
- [Runs](./runs.md) <!-- id:F3z7WZUR -->
- [Park and wait](./park.md) <!-- id:YWUkk7VG -->
- [Persistence](./persistence.md) <!-- id:npo2M1ss -->
- [Security: script safety](./security.md) <!-- id:NIoT76BG -->
