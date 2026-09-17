---
name: Runs
summary: "Runs are everything that executes: every turn, child, and script is a durable row in one tree that doubles as the dispatch queue."
---
**Runs**: everything that executes. Every turn, [child](./child.md), and [script](./script.md) is a run row in a tree, and the same table is the dispatch queue. Waiting runs hold no resources (see [park](./park.md)). The table is `runs` in [persistence](./persistence.md). <!-- id:Dnidzb7V -->

# See also

- [Space](./space.md)
- [Log](./log.md)
- [Child](./child.md)
- [Park and wait](./park.md)
- [Journal](./journal.md)
- [Persistence](./persistence.md)
- [Operations: run queue](./operations.md)
