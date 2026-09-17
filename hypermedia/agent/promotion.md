---
name: Promotion
summary: Once a tool's contract has appeared in a thread, promotion makes it a provider tool for the rest of that thread.
---
**promotion**: once a tool's [contract](./contract.md) enters the transcript, through a [read](./read.md) or a [call](./call.md), the tool becomes a provider tool for the rest of the thread. The runtime derives this only from durable events, so it survives restarts. Promotion never adds a tool outside the agent's [grants](./grants.md) and its own enabled tool documents. See [tools](./tools.md). <!-- id:Zw253_02 -->

# See also

- [Contract](./contract.md)
- [Call](./call.md)
- [Tool document](./tool-document.md)
- [Grants](./grants.md)
- [Tools](./tools.md)
- [Security](./security.md)
