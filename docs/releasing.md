# Releasing

How to cut a production release. Each step depends on the previous one — do them in order.

## 1. Determine the release number

Versions follow `YYYY.M.N`: current year, current month (no zero-padding), and an incrementing
number for releases within that month. The 3rd release of July 2026 is `2026.7.3`.

Find the previous release with `git tag --sort=-creatordate | head -5`. If the latest tag is from
the current month, increment its last number; otherwise start over at `.1` for the new month.

## 2. Tag the release

Tag the commit to be released (normally the tip of `main`) and push the tag:

```sh
git tag 2026.7.3
git push origin 2026.7.3
```

Pushing a `*.*.*` tag triggers the release workflows (`Release - Desktop App`,
`Release - Docker Images`).

## 3. Wait for GitHub Actions to complete

The `Release - Desktop App` workflow builds all platforms and creates the GitHub release (as a
prerelease) with the build artifacts attached. Watch it with:

```sh
gh run list --workflow release-desktop.yml
gh run watch <run-id>
```

Builds take a while. Do not proceed until the release exists and the workflows are green.

## 4. Write the release notes

Update the GitHub release body with release notes (`gh release edit <tag> --notes-file ...`).

The workflow creates the release as a **prerelease**; publishing the notes is also the moment to
promote it: `gh release edit <tag> --notes-file <file> --prerelease=false --latest`.

Look at the commits since the previous tag (`git log <prev-tag>..<tag> --oneline`) and at the
bodies of the last few releases (`gh release view <tag>`) to stay consistent in tone and format:

- Sections used in past releases: `## ✨ Features` and `## 🐛 Bug Fixes` (omit an empty section).
- End with the changelog link:
  `**Full Changelog**: https://github.com/seed-hypermedia/seed/compare/<prev-tag>...<tag>`
- Be very short when describing new features. A feature may span 10 commits but is worth only one
  entry. Group related commits into a single user-facing line.
- Do not write notes for fixes to regressions that were introduced and fixed within the same
  release cycle — the bug was never in a released version, so users never saw it. When in doubt,
  check whether the buggy commit is reachable from the previous release tag.
- Write for users, not developers: describe the visible behavior, not the implementation.
  Internal-only changes (refactors, CI, tests) are usually not worth an entry.

## 5. Publish latest.json

Manually run the `Generate latest.json (prod)` workflow so desktop auto-update picks up the new
version:

```sh
gh workflow run "Generate latest.json (prod)"
```
