---
type: agent-rules
schema_version: 1
title: Knowledge Manager — Rules
created_by: knowledge-manager
---

# Rules

Hard policy enforced by the agent's MCP wrapper on every tool call. The first fenced YAML block below is the **machine-readable rules**; the prose after it is human context.

```yaml
# ----- machine-readable rules begin -----
allow_write_paths:
  - /
deny_write_paths:
  - /agents/knowledge-manager/charter
  - /agents/knowledge-manager/rules
  - /agents/knowledge-manager/runbook
  - /agents/knowledge-manager/allowlist
caps:
  max_documents_per_run: 1
  max_comments_per_run: 5
  max_comments_per_day: 30
  poll_interval_seconds: 60
mentions:
  trigger: "@knowledge-manager"
  invoker_source: "writer-capabilities"   # or "allowlist-doc"
moderation:
  blocked_authors: []
draft_only: false
language: en
# ----- machine-readable rules end -----
```

## Notes

- `allow_write_paths: ["/"]` lets the agent edit any document on the site. The wrapper still refuses anything in `deny_write_paths` and refuses non-document mutations (no `key`, no `capability`, no `account`, no deletion of governance docs).
- `draft_only: true` is the **kill-switch**. When true, the agent never writes a document; it only posts comments. Effective within ≤60s.
- `invoker_source: writer-capabilities` makes the agent only respond to mentions from accounts that hold a WRITER capability on the site (plus the site account itself). Switch to `allowlist-doc` to use the explicit list in `allowlist`.
- `caps` are per the local server clock (UTC). `max_comments_per_day` resets at 00:00 UTC.
