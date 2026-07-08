---
type: agent-allowlist
schema_version: 1
title: Knowledge Manager — Allowlist
created_by: knowledge-manager
---

# Allowlist

Used only when `mentions.invoker_source` in `rules` is set to `allowlist-doc`. Otherwise the agent uses the WRITER capability set as its invoker list.

```yaml
# ----- allowlist begin -----
invokers: []   # accountIds (z6Mk...) allowed to mention the agent
# ----- allowlist end -----
```

## Notes

- v1 leaves this empty and uses `writer-capabilities` instead.
- v2 (deferred) introduces a "members" tier with a more restrictive ruleset; that mode reads this list.
