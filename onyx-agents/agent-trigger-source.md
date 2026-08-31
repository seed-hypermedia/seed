---
name: "Agent trigger source"
summary: "The activity source or filter that decides when a trigger fires."
---

A union of six sources: `webhook` (an incoming HTTP firing), `document-comment` (a comment on a watched resource, optionally by a specific author), `user-mention` (watched accounts mentioned under an optional path prefix), `site-update` (events under a resource prefix), `schedule` (see [agent-schedule](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-schedule)), and `run-completed` — fires when a run finishes, the source that lets automations chain.
