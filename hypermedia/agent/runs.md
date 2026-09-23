---
name: Runs
summary: "Runs are everything that executes: every turn, child, and script is a durable row in one tree that doubles as the dispatch queue."
---
**Runs**: everything that executes. Every turn, [child](./child.md), and [script](./script.md) is a run row in a tree, and the same table is the dispatch queue. Waiting runs hold no resources (see [park](./park.md)). The table is `runs` in [persistence](./persistence.md). <!-- id:Dnidzb7V -->

# See also <!-- id:JziVjg_v -->

- [Space](./space.md) <!-- id:F089j8_o -->
- [Log](./log.md) <!-- id:ksh_Ocrh -->
- [Child](./child.md) <!-- id:00EAYv4c -->
- [Park and wait](./park.md) <!-- id:t0WCiO48 -->
- [Journal](./journal.md) <!-- id:um8xEkxt -->
- [Persistence](./persistence.md) <!-- id:DCs1TMmW -->
- [Operations: run queue](./operations.md) <!-- id:EfQoLhH0 -->
