---
name: weekly-demo
description:
  Use when preparing a weekly team demo, deciding what to show colleagues from recent work, or refreshing a previous
  demo checklist after more commits. Not for release notes or a code review.
---

# Weekly demo

Turn the user's recent repository work into a meeting guide, not a commit dump. Explain what changed, why it matters,
and what to show. Include unfinished local work without presenting it as shipped or verified.

## Invocation and defaults

Examples:

- `$weekly-demo` — last seven days, plus current local changes.
- `$weekly-demo last week, 5-minute demo` — previous Monday through Sunday in the user's timezone.
- `$weekly-demo since 2026-10-01, 10 minutes` — explicit start date through now.
- `$weekly-demo refresh` — update the previous report using the same dates and author scope.

Accept dates, an author, a branch, and a meeting duration in ordinary language. Do not require flags or a script.
Default to a five-minute demo. State the exact date range, timezone, author identities, branch, and review time. Do not
silently expand the period when little work is found. Date-only end dates include that full local day.

Use the current repository and worktree by default. If the user requests main while another branch is active, inspect
the local main ref without switching branches. Label current-worktree edits separately. Do not include other branches or
worktrees unless requested. Ask only when identity or scope cannot be resolved with reasonable confidence.

## Collect evidence without changing the repository

Follow repository instructions. In Seed, run repository commands with `direnv exec .`. Do not fetch, switch branches,
stage, commit, alter files, or start an app to prepare this report. Do not create a report file unless requested. Do not
read ignored files, credentials, or private security notes.

1. Read Git status, the current branch, local refs, remotes, and configured user name/email. Check for a shallow clone
   or missing refs and disclose incomplete history. Inspect recent author identities and `.mailmap`, if present. Include
   confirmed aliases for the same person; do not match unrelated people by a loose substring. Do not count other
   people's commits merely because they are on the user's branch. Label explicit co-authored work as shared.
2. Read all commits in the interval on the selected ref, including full hashes, author and committer dates, subjects,
   and bodies. Use committer dates for the reporting interval and disclose that convention. Use `--since-as-filter` with
   explicit timezone-aware start and end timestamps so unusual date ordering does not hide commits. Inspect other
   authors' changes only as needed to establish the final state of the user's work.
3. Read both staged and unstaged diffs and list non-ignored untracked files. Inspect relevant source and tests,
   including untracked source files, rather than relying only on diff statistics. Do not print private data or large
   generated/binary files. Local changes have no reliable author or work date: label them as current local work, outside
   the commit date filter, with authorship unverified.
4. For each candidate demo, inspect commit details and current code as needed to establish the user-visible result.
   Combine related fixes, polish, tests, and follow-up commits into one feature story. Check for reverts, disabled
   features, superseded changes, and work that is no longer present. Put these in a short caution section, not the demo.
5. Compare the selected ref with its configured upstream when available. Distinguish commits present in that local
   upstream ref from local-only commits. Label remote information as a local snapshot; do not claim a live remote check.
   No upstream means unknown sync status, not that every commit is unpushed.

Useful read-only commands include `git status --short --branch`, `git log`, `git show`, `git diff`, `git diff --cached`,
`git ls-files --others --exclude-standard`, and `git rev-list --left-right --count`. Do not cap the log at an arbitrary
number of commits and call it complete.

## Build the meeting guide

Prioritize visible user value and a coherent flow over commit count. Choose a few main demos that fit the requested
duration. Give the remaining work a compact, grouped inventory so it is not lost. Include maintenance, docs, tests, and
infrastructure as brief talking points when they do not suit a live demo.

For each main demo, provide:

- **What changed:** A short before/after explanation in user terms.
- **Why it matters:** One sentence the user can say to colleagues. Do not invent measured benefits.
- **Show:** A short sequence of actions and the expected visible result, based on code or docs. Mark uncertain steps as
  needing rehearsal rather than inventing menu labels.
- **Prepare:** Required platform, sample content, accounts, permissions, or a suggested screenshot fallback.
- **Status and evidence:** Committed/local-only/uncommitted, verification known or not checked, and supporting refs.

Use clickable commit or PR links when the remote and reference are known. Local-only commits may not have working remote
links: use their short hashes and relevant file paths instead. Uncommitted work has file paths, not PR links. Committed,
merged, deployed, and verified are separate facts. Test files are not evidence that tests passed. Do not claim live demo
readiness without an observed check. Default to “Needs rehearsal” when runtime evidence is absent. If the user requests
rehearsal, follow repository run-environment instructions before browser or HTTP checks.

Use this output shape, omitting empty sections:

1. **Scope:** Exact dates, identity, branch, collection time, and evidence limits.
2. **Suggested demo order:** Numbered main demos with estimated times; total must fit the meeting duration.
3. **Other work to mention:** A compact checklist of remaining feature groups and supporting work.
4. **Local work and cautions:** Uncommitted changes, local-only commits, disabled work, and demo risks.
5. **Before the meeting:** A short preparation checklist tailored to the selected demos.

If repository instructions require a final `## Recap`, use it for the recommended demo sequence and key cautions. Keep
the main guide concise. Include a full per-commit appendix only if requested. Do not hide work to make it fit: group it
in the inventory instead. If no suitable live demo exists, offer an honest progress update with evidence.

## Refresh a previous guide

Read status and history again; do not reuse old counts. Preserve the previous date and identity scope unless changed by
the user. If the previous interval ended at “now,” advance that endpoint and state the new review time. Compare feature
stories as well as hashes: a rebase can change hashes without adding work. Do not count both versions. Move newly
committed work out of the uncommitted section. Highlight new behavior, status changes, and remaining local edits, then
give the updated demo order. If the earlier report is unavailable, produce a fresh report and say so.
