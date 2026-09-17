---
name: History
summary: The dated design records that shaped today's Hypermedia model, kept as written, plus where to find the build history that no longer lives on this site.
---
This section keeps design records that are worth reading after the decision they fed. A history page is dated and is not revised to match later code. When a record and a [concept page](./protocol.md) disagree, the concept page describes what the software does today, and the record explains how the team got there or where it wanted to go. <!-- id:SdkPNtJF -->

Records are here because they still inform the code: they name the problems a design had to solve, the options that were rejected, and why. For decided but unbuilt direction, read [Where this is going](./protocol/roadmap.md) instead. <!-- id:-HsvAZdb -->

# Permissions investigation <!-- id:fhLy0raI -->

Written by Eric Vicenti in late August 2026 and added to this folder on 2026-09-02. It is a design investigation. Nothing in it was decided. The shipped model is on [Permissions](./protocol/permissions.md) and [Privacy](./protocol/privacy.md). <!-- id:rjhzp1ed -->
  - [Permissions System](./history/permissions.md) is the entry point: the verdict, the reading order, and the three choices the design rests on. <!-- id:TXXjCUPy -->
  - [How Privacy Works Today](./history/permissions/current-state.md) maps the [visibility](./protocol/privacy.md), [capability](./protocol/permissions.md) and authentication machinery the daemon had at the time, including its known gaps. <!-- id:iKylgTlg -->
  - [Tearing the Proposal Apart](./history/permissions/critique.md) attacks each pillar of the original proposal against the real codebase and records what survived. <!-- id:MgWSx6RW -->
  - [Permissions Rabbit Holes](./history/permissions/rabbit-holes.md) ranks the six research-sized problems (revocation, time, transitive access, history, groups, the query surface) and names a practical way past each. <!-- id:OS8P8B3R -->
  - [Prior Art for Content Permissions](./history/permissions/prior-art.md) takes lessons from UCAN, Tahoe-LAFS, macaroons, Biscuit, Scuttlebutt, Matrix and object-capability systems. <!-- id:7ec9B3fB -->
  - [Everything Is a Grant](./history/permissions/grants.md) is the rebuilt design: one signed grant statement with explicit audiences, ordering by position in a signed chain in place of timestamps, and an honest trusted-server model. <!-- id:PP2WHx3p -->
  - [V1 Proposal (Archived)](./history/permissions/v1-proposal.md) is the original proposal, preserved unchanged as the subject of the critique. <!-- id:A5-CJfyG -->

As of September 2026 none of the grant design is implemented. Its questions carry forward into the permissions section of [Where this is going](./protocol/roadmap.md). <!-- id:ziYhttOL -->

# Seed Agents build history and finished plans <!-- id:CerNTUVk -->

The [Seed Agents](./agent.md) pages used to include an implementation log, harness design reviews, and the plans for projects that have since shipped. They were removed from this site in September 2026 because the reference pages now describe the result. Plans that are still live remain under [Seed Agents](./agent.md), with a status line, and the one live roadmap is [Agents roadmap](./agent/roadmap.md). <!-- id:YjBLstIc -->

The removed pages are kept in [git](https://git-scm.com/). They lived at `hypermedia/agent/history/` and `hypermedia/agent/plans/`, and the last commit that still contains all of them is the parent of commit `179157482`. List and read them from a clone of the repository: <!-- id:TVb_5nMK -->

```sh <!-- id:Ome4iWFD -->
git ls-tree -r --name-only 179157482~1 hypermedia/agent/history hypermedia/agent/plans
git show 179157482~1:hypermedia/agent/history/implementation.md
git log --oneline -- hypermedia/agent/history hypermedia/agent/plans
```

What you will find there: <!-- id:rDhagt52 -->

<!-- id:elUJiMHh -->
| Path <!-- col:WIWJwTV7 --> | What it recorded <!-- col:I3Lwipkx --> <!-- id:K12zhRxj --> |
| --- | --- |
| `agent/history/implementation.md` | the build log of the runtime, milestone by milestone <!-- id:4ZzLPfw_ --> |
| `agent/history/write-tool-implementation-notes.md` | notes from building the `write` verb <!-- id:P5LPesSE --> |
| `agent/history/harness/` | the harness plan and guide, the event bus design, and five design reviews (verbs, tools as documents, the symmetric log, orchestration UX, execution time) <!-- id:yWKBMOky --> |
| `agent/plans/` | finished plans: desktop agent unification, desktop assistant writes, the execution warm pool, markdown tables, the Pi SDK migration, run concurrency, triggers, workflows, write tool CLI parity, the performance squeeze, and the old roadmap and future-projects lists <!-- id:tl-I3afU --> |

Git history is also the record for older names and designs, such as Mintter, groups, and key delegations. The [Glossary](./glossary.md) lists them in its table of retired names. <!-- id:8NlaOfJw -->

# See also <!-- id:ytrcC0Iy -->

- [Where this is going](./protocol/roadmap.md), the dated direction that these records fed. <!-- id:RBjW2qj8 -->
- [Permissions](./protocol/permissions.md) and [Privacy](./protocol/privacy.md), the model as it ships. <!-- id:v8W48soX -->
- [Contributing](./build/contributing.md), for how protocol changes are proposed today. <!-- id:OoVUaUoS -->
- [Glossary](./glossary.md), including retired names. <!-- id:yrUgU5r1 -->
