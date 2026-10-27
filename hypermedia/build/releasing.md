---
name: Releasing
summary: "How a maintainer cuts a production release of Seed, in order: pick the version number, tag it, wait for the build workflows, write the release notes, and publish latest.json for desktop auto-update."
---
How to cut a production release. Each step depends on the previous one, so do them in order. <!-- id:rtTJsaom -->

# 1. Determine the release number <!-- id:LFlT8G4- -->

Versions follow `YYYY.M.N`: current year, current month (no zero-padding), and an incrementing number for releases within that month. The 3rd release of July 2026 is `2026.7.3`. <!-- id:8Tj5ZLUT -->

Find the previous release with `git tag --sort=-creatordate | head -5`. If the latest tag is from the current month, increment its last number; otherwise start over at `.1` for the new month. <!-- id:sLoEA1Ub -->

# 2. Tag the release <!-- id:qTvDvfFw -->

Tag the commit to be released (normally the tip of `main`) and push the tag: <!-- id:D2_5ffJa -->

```sh <!-- id:J6dLj7r4 -->
git tag 2026.7.3
git push origin 2026.7.3
```

Pushing a `*.*.*` tag triggers the release workflows (`Release - Desktop App`, `Release - Docker Images`). The Docker workflow ends by publishing the released `hypermedia/` tree to the developer docs site on hyper.media (`Repo HM sync (hypermedia)`, target `production`, signed with the `SEED_DOCS_KEYFILE` secret); merges to `main` publish the same tree to staging.hyper.media as they land. <!-- id:R6L7_vPz -->

# 3. Wait for GitHub Actions to complete <!-- id:9y1YbuaV -->

The `Release - Desktop App` workflow builds all platforms and creates the GitHub release (as a prerelease) with the build artifacts attached. Watch it with: <!-- id:kiA4JdV2 -->

```sh <!-- id:sIhGMgiL -->
gh run list --workflow release-desktop.yml
gh run watch <run-id>
```

Builds take a while. Do not proceed until the release exists and the workflows are green. <!-- id:Dwc8td8I -->

# 4. Write the release notes <!-- id:VVCY-0kc -->

Update the GitHub release body with release notes (`gh release edit <tag> --notes-file ...`). <!-- id:mfkmu5D8 -->

The workflow creates the release as a **prerelease**; publishing the notes is also the moment to promote it: `gh release edit <tag> --notes-file <file> --prerelease=false --latest`. <!-- id:astfqT32 -->

Look at the commits since the previous tag (`git log <prev-tag>..<tag> --oneline`) and at the bodies of the last few releases (`gh release view <tag>`) to stay consistent in tone and format: <!-- id:O7j2tT_e -->
  - Sections used in past releases: `## ✨ Features` and `## 🐛 Bug Fixes` (omit an empty section). <!-- id:pwjyz8qZ -->
  - End with the changelog link: `**Full Changelog**: https://github.com/seed-hypermedia/seed/compare/<prev-tag>...<tag>` <!-- id:Cd4xHvoJ -->
  - Be very short when describing new features. A feature may span 10 commits but is worth only one entry. Group related commits into a single user-facing line. <!-- id:_DDT7Dhw -->
  - Do not write notes for fixes to regressions that were introduced and fixed within the same release cycle, the bug was never in a released version, so users never saw it. When in doubt, check whether the buggy commit is reachable from the previous release tag. <!-- id:dOhC_Uh9 -->
  - Write for users, not developers: describe the visible behavior, not the implementation. Internal-only changes (refactors, CI, tests) are usually not worth an entry. <!-- id:5eiVKjh6 -->

# 5. Publish latest.json <!-- id:tu62u8Oj -->

Manually run the `Generate latest.json (prod)` workflow so desktop auto-update picks up the new version: <!-- id:TsSX-oHy -->

```sh <!-- id:s4pnUPRT -->
gh workflow run "Generate latest.json (prod)"
```
