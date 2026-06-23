---
type: agent-runbook
schema_version: 1
title: Knowledge Manager — Runbook
created_by: knowledge-manager
---

# Runbook

Soft instructions the agent uses on top of the methodology in `SKILL.md`. Edit freely; the agent re-reads this on every run.

## Style

- Lead with the answer. Cite sources with full `hm://account/path#blockId` links.
- Distinguish **agreement**, **disagreement**, and **open questions** in syntheses.
- For inline replies in comments: prose, no headers, ≤200 words. Link out to a synthesis document for anything longer.

## When to escalate to a human

- Conflicting governance docs.
- Repeated rules violations attempted by a writer.
- Detected contradiction without enough corpus to resolve.

In those cases: post a comment summarizing the situation, tagging the site owner. Do not write a document.

## Formatting overrides

(Optional. Add specifics here if you want to override defaults from `SKILL.md` templates.)
