---
name: Seed developer docs
summary: Documentation that lives next to the code, in this repository, and is published to the Hypermedia network from here.
---
These pages are markdown files checked into the Seed repository under `hypermedia/`. A commit to `main` publishes them to this site, so what you read here is exactly what the code ships with. Very cool, right?! <!-- id:-gK0HbNj -->

The folder is also an example of a workflow: the markdown is the source of truth, but the Seed app can be the editor. See [Repo HM sync](./doc/repo-hm-sync.md) for how a directory of markdown files in a repository and a Hypermedia space mirror each other, and [CLI](./doc/cli.md) for the commands. <!-- id:_G1k0qF- -->

# Developer docs

Everything that is not a concept, a schema, an API method or an example is collected under [Developer docs](./doc.md).

# Publishing <!-- id:qquyu_Qe -->

- [Repo HM sync](./doc/repo-hm-sync.md) — the lossless markdown dialect and the export, import and dev commands. <!-- id:m2GuhDRm -->
- [CLI](./doc/cli.md) — the `seed-cli` commands this folder is published with. <!-- id:4Fo9jG63 -->

# Hypermedia Schemas <!-- id:G9c9jn03 -->

[Hypermedia Schemas](./schema.md) is the self-describing type system for content-addressed data that Hypermedia documents are built from. Every schema in the library is a page here, with its formal definition attached, and the reference chapters explain the system from the top down: <!-- id:lsYfVMeq -->
  - [Why Hypermedia Schemas](./doc/schema/why.md), [How Hypermedia Schemas work](./doc/schema/how-it-works.md), [Typed documents](./schema/typed-documents.md), [The World Builder](./doc/world-builder.md), [The typed API](./rpc.md) <!-- id:u75glGr1 -->
  - [User stories](./doc/schema/user-stories.md) — what a person should be able to do with schemas through the app, the CLI, and an agent: the steps, and where each surface stands. <!-- id:pSOZzOrZ -->
  - [The data model](./schema/data-model.md), [The schema language](./schema/schema-language.md), [References & naming](./schema/references.md), [Encoding](./schema/encoding.md), [Examples](./example.md), [Schemas on the Hypermedia Network](./schema/blobs.md), [Design rationale](./doc/schema/design.md), [Glossary](./schema.md) <!-- id:CEaJilu0 -->
  - [Hypermedia Permissions System](./doc/permissions.md) — a design investigation into permissions and privacy for Hypermedia content. <!-- id:SIUblIDE -->

# Agents <!-- id:v3ihjVoi -->

[Seed Agents](./agent.md) is the account-scoped agent runtime, the Harness: a Bun service with a signed API, SQLite persistence and a desktop UI. Its documentation lives under `agent/`: <!-- id:ugp7F8mP -->
  - Start with [the system overview](./agent/system-overview.md), [the terms](./agent.md) and [development](./agent/development.md). <!-- id:JqSMa6qL -->
  - Design and operations: [tools](./agent/tools.md), [the signed API](./agent/signed-api.md), [persistence](./agent/persistence.md), [security](./agent/security.md), [operations](./agent/operations.md), [troubleshooting](./agent/troubleshooting.md). <!-- id:M4LYVFUH -->
  - The Harness rebuild: [plan](./agent/history/harness/plan.md), [build log](./agent/history/harness/build-log.md), [roadmap](./agent/plans/roadmap.md), [future projects](./agent/plans/future-projects.md). <!-- id:BlXxGsCb -->
