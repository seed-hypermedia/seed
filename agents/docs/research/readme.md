# Agents R&D

This directory is the research playground for the next generation of the Seed Agents system. Everything here is
design-stage markdown: no doc in this directory describes shipped behavior unless it explicitly says so. Shipped
behavior stays documented in `agents/docs/` proper.

## The goal

Evolve Seed Agents from a chat-session runtime into a best-in-class agent harness. The north star
([north-star.md](./north-star.md)) is a system where:

1. **Orchestration is a first-class primitive** — agents can delegate, fan out, pipeline, and verify work across
   subagents and models deterministically, not just chat in one loop. The orchestrator is a simple but flexible language
   — expressed as JavaScript — whose atomic unit is an **action**: a sub-agent run, an explicit lambda (sandboxed code),
   or a built-in tool all share one callable shape, and the language provides the primitives to chain them sequentially
   and in parallel.
2. **Tools are modular, schema'd, and progressively discovered** — a small always-loaded core plus a searchable registry
   of deferred tools, user-defined tools, and code-execution lambdas, so context is spent on the task rather than on
   tool definitions. Action input/output types are expressed in **Onyx**, the self-describing IPLD/DAG-CBOR schema
   system (branch `feat/onyx`, `frontend/packages/ui/src/onyx/`): schemas are content-addressed, publishable as
   hypermedia documents, and shared across the network — which makes the action registry itself a discoverable,
   verifiable hypermedia artifact rather than a compile-time object literal.
3. **The system configures itself through conversation** — creating agents, tools, triggers, and workflows are
   themselves tool calls, so a sufficiently capable root agent can build out its own harness on request.
4. **The default UX is one text input** — a single conversational surface that manages its own context (threads,
   compaction, delegation) instead of asking the user to manage sessions by hand.

## Documents

- [north-star.md](./north-star.md) — the target architecture in one document; start here.
- [current-system-analysis.md](./current-system-analysis.md) — code-grounded map of what exists today and where it falls
  short of the north star.
- [orchestration.md](./orchestration.md) — subagents, runs, workflows, delegation, parallelism, verification.
- [tool-system.md](./tool-system.md) — modular tool registry, schemas, progressive discovery, code-exec lambdas,
  user-defined tools.
- [self-configuration.md](./self-configuration.md) — the harness configuring itself through conversation.
- [context-and-threads.md](./context-and-threads.md) — replacing the session architecture with a self-managing
  conversational surface: threads, compaction, memory integration.
- [migration.md](./migration.md) — phased path from today's system to the north star.

## Working method

R&D here is done markdown-first, iterated with multi-agent workflows (independent design passes, adversarial review,
synthesis). Each document records open questions at the bottom; resolved questions move into the body with their
rationale. When a design graduates to implementation, its doc gains a status header and the shipped behavior gets
documented in `agents/docs/` per the routing table in `agents/docs/readme.md`.
