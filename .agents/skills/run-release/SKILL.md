---
name: run-release
description: 'Cut a production release: tag, wait for CI, write release notes, publish latest.json.'
---

# Run Release

Execute the release process in `docs/releasing.md`. That doc is canonical for the process details;
this skill is the interactive runbook. Invoking this skill counts as explicit permission to create
and push the release tag, but confirm the version number with the user before pushing it.

## Steps

1. **Preflight**: confirm you are on `main`, the working tree is clean, and local `main` matches
   `origin/main`. Abort and report if not.
2. **Determine the version** (`YYYY.M.N`, see `docs/releasing.md`): check
   `git tag --sort=-creatordate | head -5`. If the latest tag is from the current month, increment
   its last number; otherwise start at `.1` for the current month.
3. **Confirm** the version and the commit to be tagged with the user.
4. **Tag and push**: `git tag <version> && git push origin <version>`.
5. **Wait for the release workflows** (`Release - Desktop App`, `Release - Docker Images`) to go
   green: `gh run list --workflow release-desktop.yml`, then `gh run watch <run-id>`. Builds take
   tens of minutes — keep waiting, don't proceed early. If a workflow fails, stop and report.
6. **Draft release notes** for `<prev-tag>..<version>` following the voice, grouping, and
   exclusion rules in the `releasenotes` skill, but match the exact format of the last few
   published releases (`gh release view <prev-tag>`). Key rules from `docs/releasing.md`:
   - Very short feature entries; many commits often collapse into one line.
   - No entries for regressions introduced and fixed since the previous tag — never released,
     users never saw them.
   - End with the `**Full Changelog**` compare link.
7. **Show the draft to the user** and apply their edits, then publish:
   `gh release edit <version> --notes-file <tmpfile> --prerelease=false --latest`
   (the workflow creates the release as a prerelease; this promotes it).
8. **Publish latest.json** so desktop auto-update sees the release:
   `gh workflow run "Generate latest.json (prod)"` and confirm the run succeeds.
9. **Report**: version, release URL, and the state of each step.
