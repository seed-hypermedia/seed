---
name: "Agent trigger"
summary: "An automation rule on an agent: when to fire, and what a firing does."
---

An automation rule: a named, enableable [source](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-trigger-source) decides when it fires; `prompt` is the first message of the thread a firing starts; an optional [continuation](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-trigger-continuation) instead wakes a parked run or calls a tool or script headlessly. Stored the way tool documents are stored: canonical DAG-CBOR, CID over the bytes.
