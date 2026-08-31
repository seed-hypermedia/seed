---
name: "Agent tool call"
summary: "A content-addressed record of one tool invocation."
---

One tool invocation — which tool, with what input — as a content-addressed blob. An [agent-tool-call-block](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-tool-call-block) inside an agent-signed [message](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-message) references it by CID, so the transcript block stays small, the payload carries no hidden block attributes, and the full record is real permanent data. Paired with [agent-tool-result](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-tool-result) by `callId`.
