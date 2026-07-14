---
name: report-issue
description:
  Interactively investigate a bug by grilling the user, exploring the codebase for suspects and solutions, suggesting
  related test scenarios, and then creating a well-structured GitHub issue via `gh` CLI. Use when the user wants to
  report a bug, file an issue, create a GitHub issue, or says things like "file a bug", "create an issue", "report this
  bug", "open an issue", or "github issue". Also trigger when the user describes unexpected behavior and wants to track
  it formally.
---

# GitHub Issue Creator

Investigate a bug report interactively, then create a clean GitHub issue via the `gh` CLI.

## Prerequisites

Before starting, determine which authenticated GitHub capability is available. Prefer the connected GitHub app; use
`gh` as a fallback. When using `gh`, verify authentication:

```bash
gh auth status
```

If neither an authenticated connector nor authenticated `gh` is available, investigate and draft the issue but stop
before creation and explain how to unblock publication.

Also confirm you're inside a git repo with a GitHub remote:

```bash
git remote -v
```

If not, ask the user which repo the issue should be filed against.

## Phase 1: Grill the user

Interview the user one question at a time to build a complete picture of the bug. For each question, provide your
recommended answer based on what you already know from context or the codebase.

Walk through these areas, but adapt to what's already known — skip questions the user has already answered:

1. **What happened?** — A clear description of the unexpected behavior.
2. **What was expected?** — What should have happened instead.
3. **Steps to reproduce** — The exact sequence to trigger the bug.
4. **Environment** — OS, browser, runtime version, or any relevant env details (only ask if likely relevant).
5. **Frequency** — Does it always happen, or only sometimes? Under what conditions?
6. **Impact** — How severe is this? Does it block anything?

If a question can be answered by exploring the codebase, explore the codebase instead of asking.

## Phase 2: Investigate the codebase

Once you understand the bug, dig into the code:

1. **Find suspects** — Search for the code paths most likely involved. Look at recent changes in those areas
   (`git log --oneline -10 -- <file>`). Summarize what you find for the user.
2. **Propose possible causes** — Based on the code, suggest what might be going wrong and why.
3. **Suggest fixes** — If a solution seems clear, describe the approach briefly. This goes into the issue body as
   context, not as a commitment.

Share your findings with the user and ask if they want to add or correct anything.

## Phase 3: Related test scenarios

Before creating the issue, suggest 2-4 related scenarios the user should also verify. These are edge cases or adjacent
behaviors that might be affected by the same root cause.

Ask the user:

- Have you observed any of these?
- Should any of them be included in the issue or filed separately?

## Phase 4: Create the issue

Once everything is gathered, compose the issue using this structure:

```markdown
## Description

[Clear description of the bug]

## Steps to Reproduce

1. [Step 1]
2. [Step 2]
3. [Step 3]

## Expected Behavior

[What should happen]

## Actual Behavior

[What happens instead]

## Possible Suspects

- `path/to/file.ts` — [why this file is suspicious]
- [any other relevant code areas]

## Suggested Solutions

- [Approach 1 and reasoning]
- [Approach 2 if applicable]

## Related Scenarios to Verify

- [ ] [Scenario 1]
- [ ] [Scenario 2]

## Environment

- [Relevant environment details]
```

Show the full composed issue (title + body) to the user for approval before creating it.

Once approved, create it with the connected GitHub app or `gh`:

```bash
gh issue create --title "<title>" --body "<body>"
```

Use proper escaping for the body content. If the body is long, write it to a temp file and use:

```bash
gh issue create --title "<title>" --body-file /tmp/issue-body.md
```

After creation, show the user the issue URL returned by `gh`.
