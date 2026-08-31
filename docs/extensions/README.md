# Seed Extensions

Extensions ("plugins") let anyone build a full-page app that runs inside a Seed site — on the web and in the desktop app
— reads hypermedia data, and signs as the viewer, without ever holding a key. Extensions are themselves hypermedia
documents, so they are signed, versioned and distributed peer-to-peer like everything else on the network.

| Document                                     | Audience          | What it covers                                                                                        |
| -------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------- |
| [project-report.md](./project-report.md)     | everyone          | Where things stand: scope delivered, how to try it, verification, environment notes, what is not done |
| [design.md](./design.md)                     | implementers      | The normative design: data model, rendering, bridge, security, workflow                               |
| [developer-guide.md](./developer-guide.md)   | extension authors | From `pnpm create` to a published, installed extension, with hot reload                               |
| [bridge-api.md](./bridge-api.md)             | extension authors | Every SDK method and bridge message, with examples                                                    |
| [site-owner-guide.md](./site-owner-guide.md) | site owners       | Installing, pinning, updating and removing extensions (desktop + CLI)                                 |
| [cli.md](./cli.md)                           | everyone          | `seed-cli extension …` reference                                                                      |
| [security.md](./security.md)                 | everyone          | Threat model, what the sandbox guarantees, what it does not                                           |
| [testing.md](./testing.md)                   | implementers      | How the system is tested and the verification log for this branch                                     |
| [roadmap.md](./roadmap.md)                   | team              | Other extension kinds and what carries over                                                           |
| [decisions.md](./decisions.md)               | team              | Decision log with rationale                                                                           |

The example extensions live in [`/extensions/examples`](../../extensions/examples): `hello-signer` (bridge smoke test),
`site-dashboard` (read-only site overview), `kanban` (board state stored in a document, saved by signing).

The same documents are published on the network under the Starlight space, section **Extensions**.
