---
name: Releasing
summary: "How a maintainer cuts a production release of Seed, in order: pick the version number, tag it, wait for the build workflows, write the release notes, and publish latest.json for desktop auto-update."
---
This page is the list of steps a maintainer follows to make a production release of Seed. A release ships three things: the [desktop app](../software/desktop.md), the Docker images, and the production copy of these docs. Each step depends on the one before it, so do them in order. The `.agents/skills/run-release` skill in the repository takes a coding [agent](../agent.md) through the same steps. <!-- id:rtTJsaom -->

# 1. Determine the release number <!-- id:LFlT8G4- -->

A version has the form `YYYY.M.N`: the year, the month with no leading zero, and a number that counts the releases in that month. The third release of July 2026 is `2026.7.3`. <!-- id:8Tj5ZLUT -->

Find the last release with `git tag --sort=-creatordate | head -5`. If the latest tag is from this month, add one to its last number. If not, start at `.1` for the new month. <!-- id:sLoEA1Ub -->

# 2. Tag the release <!-- id:qTvDvfFw -->

Tag the commit you want to release, normally the newest commit on `main`, and push the tag: <!-- id:D2_5ffJa -->

```sh <!-- id:J6dLj7r4 -->
git tag 2026.7.3
git push origin 2026.7.3
```

When you push a `*.*.*` tag, two release workflows start: `Release - Desktop App` and `Release - Docker Images`. The last job of the Docker workflow publishes the released `hypermedia/` folder to the docs on `hyper.media`. It does this with the `Repo HM sync (hypermedia)` workflow and the target `production`. A release is the only way the docs reach production. A merge to `main` publishes to `staging.hyper.media`. See [Editing these docs](./editing-these-docs.md). <!-- id:R6L7_vPz -->

# 3. Wait for GitHub Actions to complete <!-- id:9y1YbuaV -->

The `Release - Desktop App` workflow builds the app for every platform. Then it creates the GitHub release, as a prerelease, with the built files attached. Watch it with: <!-- id:kiA4JdV2 -->

```sh <!-- id:sIhGMgiL -->
gh run list --workflow release-desktop.yml
gh run watch <run-id>
```

The builds take some time. Do not go on until the release exists and the workflows have passed. <!-- id:Dwc8td8I -->

# 4. Write the release notes <!-- id:VVCY-0kc -->

Put the release notes in the body of the GitHub release (`gh release edit <tag> --notes-file ...`). <!-- id:mfkmu5D8 -->

The workflow creates the release as a **prerelease**. When you publish the notes, also make it the latest release: `gh release edit <tag> --notes-file <file> --prerelease=false --latest`. <!-- id:astfqT32 -->

Read the commits since the last tag (`git log <prev-tag>..<tag> --oneline`) and the notes of the last few releases (`gh release view <tag>`), so that the tone and the format stay the same: <!-- id:O7j2tT_e -->
  - Past releases use these sections: `## ✨ Features` and `## 🐛 Bug Fixes`. Leave out an empty section. <!-- id:pwjyz8qZ -->
  - End with the changelog link: `**Full Changelog**: https://github.com/seed-hypermedia/seed/compare/<prev-tag>...<tag>` <!-- id:Cd4xHvoJ -->
  - Describe a new feature in very few words. A feature may take 10 commits, but it gets one entry. Put related commits into one line that a user understands. <!-- id:_DDT7Dhw -->
  - Do not write a note for the fix of a bug that was added and fixed between two releases. The bug was never in a released version, so users never saw it. If you are not sure, check whether the commit with the bug can be reached from the last release tag. <!-- id:dOhC_Uh9 -->
  - Write for users, not for developers. Describe what a user sees, not how the code works. A change that only developers see (a refactor, CI, tests) usually gets no entry. <!-- id:5eiVKjh6 -->

# 5. Publish latest.json <!-- id:tu62u8Oj -->

Start the `Generate latest.json (prod)` workflow by hand. The desktop app reads `latest.json` to find a new version, so this step makes the app update itself: <!-- id:TsSX-oHy -->

```sh <!-- id:s4pnUPRT -->
gh workflow run "Generate latest.json (prod)"
```

# See also

- [Package publishing](./package-publishing.md), for the npm packages, which do not wait for a release.
- [Editing these docs](./editing-these-docs.md), for what the release publishes to `hyper.media`.
- [The desktop app](../software/desktop.md), which reads `latest.json` to update itself.
- [Working on Seed](../contribute.md), the list of contributor guides.
