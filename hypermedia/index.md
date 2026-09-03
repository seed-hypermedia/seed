---
name: Seed developer docs
summary: Documentation that lives next to the code, in this repository, and is published to the Hypermedia network from here.
---
These pages are markdown files checked into the Seed repository under `hypermedia/`. A commit to `main` publishes them to this site, so what you read here is exactly what the code ships with. <!-- id:-gK0HbNj -->

The folder is also an example of a workflow: the markdown is the source of truth, but the Seed app can be the editor. See [Repo HM sync](./repo-hm-sync.md) for how a directory of markdown files in a repository and a Hypermedia space mirror each other, and [CLI](./cli.md) for the commands. <!-- id:_G1k0qF- -->

# Publishing <!-- id:qquyu_Qe -->

- [Repo HM sync](./repo-hm-sync.md) — the lossless markdown dialect and the export, import and dev commands. <!-- id:m2GuhDRm -->
- [CLI](./cli.md) — the `seed-cli` commands this folder is published with. <!-- id:4Fo9jG63 -->

# Onyx

[Onyx](./onyx.md) is the self-describing type system for content-addressed data that Hypermedia documents are built from. Every schema in the library is a page here, with its formal definition attached, and the reference chapters explain the system from the top down:

- [Why Onyx](./why.md), [How Onyx works](./how-it-works.md), [Typed documents](./typed-documents.md), [The World Builder](./world-builder.md), [The typed API](./api.md)
- [The data model](./data-model.md), [The schema language](./schema-language.md), [References & naming](./references.md), [Encoding](./encoding.md), [Examples](./examples.md), [Onyx on the Hypermedia Network](./hypermedia.md), [Design rationale](./design.md), [Glossary](./glossary.md)
- [Hypermedia Permissions System](./permissions-system.md) — a design investigation into permissions and privacy for Hypermedia content.

# Agents

[Seed Agents](./agents.md) is the account-scoped agent runtime, the Harness: a Bun service with a signed API, SQLite persistence and a desktop UI. Its documentation is the `agent-` pages:

- Start with [the system overview](./agent-system-overview.md), [the glossary](./agent-glossary.md) and [development](./agent-development.md).
- Design and operations: [tools](./agent-tools.md), [the signed API](./agent-signed-api.md), [persistence](./agent-persistence.md), [security](./agent-security.md), [operations](./agent-operations.md), [troubleshooting](./agent-troubleshooting.md).
- The Harness rebuild: [plan](./agent-harness-plan.md), [build log](./agent-harness-build-log.md), [roadmap](./agent-roadmap.md), [future projects](./agent-future-projects.md).
