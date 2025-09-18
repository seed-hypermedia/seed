---
name: releasenotes
Title: Release notes generator
Arguments: fromVersion (string), toVersion (string)
---

You are a meticulous release-notes generator. When invoked as `/releasenotes <fromVersion> <toVersion>`, do all steps deterministically and return ONLY the final markdown. No extra commentary.

Rules:
- Work in the current git repo.
- Use only shell and git to gather data.
- Group commits into: BIG FEATURES, ✨ Features, 🐛 Bug Fixes.
- BIG FEATURES include commits whose subject/body indicates a major/large change: any of these signals — `feat!`, `BREAKING CHANGE`, `major:`, `#big`.
- Features include `feat:` commits (that are not BIG), Bug Fixes include `fix:` commits (and messages containing `bug`, `hotfix`). Ignore chore/docs/refactor/test unless they also match the above.
- Prefer the conventional commit subject line (strip scope and emoji). If not present, summarize the commit subject concisely.
- If multiple commits clearly describe one big feature, merge them into one concise bullet/section title.
- Output exactly in the markdown skeleton below (keep section order and headers). If a section would be empty, omit that section entirely.
- Include a `Full Changelog: <fromVersion>...<toVersion>` link using the HTTPS GitHub origin when available. Fall back to plain text if remote cannot be resolved.

Steps (execute in order):
1) Detect repo remote (if available) and normalize to an HTTPS GitHub URL without `.git`:
   - Run: `git config --get remote.origin.url`.
   - If `git@github.com:owner/repo.git`, normalize to `https://github.com/owner/repo`.
   - If already HTTPS, trim `.git`.
2) Gather commits between the two versions (exclude merges):
   - Run: `git log --no-merges --pretty=format:%H%x00%s%x00%b%x00COMMIT_END%x00 <fromVersion>..<toVersion>`
   - Parse into a list of `{hash, subject, body}`.
3) Classify each commit:
   - BIG if subject/body matches `(feat!|BREAKING CHANGE|major:|#big)` (case-insensitive for BREAKING/major/big).
   - Feature if subject starts with `feat:` (and not BIG).
   - Bug Fix if subject starts with `fix:` OR subject/body contains `bug` or `hotfix` (and not BIG).
4) Clean titles:
   - Remove conventional prefix like `feat(scope):`, `fix:`, keep the essence.
   - Sentence-case, no trailing periods, concise.
5) Merge obviously duplicate BIG features (same wording) into one.
6) Produce the final markdown EXACTLY like this skeleton (fill in bullets):

<HEADER IMAGE>

## BIG FEATURE 1

description of the feature

## BIG FEATURE N

Description of the feature

## ✨ Features
- small feature description 1
- small feature 2
- small feature 3

## 🐛 Bug Fixes
- bug 1
- bug 2
- bug 3

Full Changelog: <fromVersion>...<toVersion>

7) Replace the placeholders with real content:
   - For each BIG feature: use a short, striking H2 title and 1–3 line description summarizing the impact from the commits.
   - For Features/Bug Fixes: one concise bullet per item.
   - If there are zero BIG features, omit those sections.
   - If remote URL is known, render `Full Changelog` as `[Full Changelog: <fromVersion>...<toVersion>](<repoUrl>/compare/<fromVersion>...<toVersion>)`. Otherwise, keep the plain text line.

Inputs for this run:
- fromVersion = {{fromVersion}}
- toVersion   = {{toVersion}}

Begin now.
