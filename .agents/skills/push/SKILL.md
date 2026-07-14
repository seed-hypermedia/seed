---
name: push
description: Validate the current branch with the repository's canonical pre-push checks, then push it when the user explicitly asks to push or publish changes.
---

# Push

Follow root and subtree `AGENTS.md` instructions. Never modify source files merely to make a validation command runnable.

1. Inspect `git status`, the current branch, and the diff. Confirm that all changes belong to the requested publication.
2. Run the smallest relevant local checks required by the applicable subtree instructions.
3. Before pushing, run the matching agent-ci workflow documented in root `AGENTS.md`. Do not use `--all` or the heavy Docker-image workflow for routine changes.
4. On agent-ci failure, fix in place and retry the named runner as documented. Report environmental or unrelated failures rather than concealing them.
5. Commit only intended files. Do not amend, pull, rebase, or merge without explicit authorization.
6. Push the current branch with upstream tracking.
7. Report the commit, branch, remote, and validation results.
