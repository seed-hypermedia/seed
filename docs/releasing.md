# Releasing

How to cut a production release. Each step depends on the previous one — do them in order.

## 1. Determine the release number

Versions follow `YYYY.M.N`: current year, current month (no zero-padding), and an incrementing number for releases
within that month. The 3rd release of July 2026 is `2026.7.3`.

Find the previous release with `git tag --sort=-creatordate | head -5`. If the latest tag is from the current month,
increment its last number; otherwise start over at `.1` for the new month.

## 2. Tag the release

Tag the commit to be released (normally the tip of `main`) and push the tag:

```sh
git tag 2026.7.3
git push origin 2026.7.3
```

Pushing a `*.*.*` tag triggers the release workflows (`Release - Desktop App`, `Release - Docker Images`). The Docker
workflow ends by publishing the released `hypermedia/` tree to the developer docs site on hyper.media
(`Repo HM sync (hypermedia)`, target `production`, signed with the `SEED_DOCS_KEYFILE` secret); merges to `main` publish
the same tree to staging.hyper.media as they land.

## 3. Wait for GitHub Actions to complete

The `Release - Desktop App` workflow builds all platforms and creates the GitHub release (as a prerelease) with the
build artifacts attached. Watch it with:

```sh
gh run list --workflow release-desktop.yml
gh run watch <run-id>
```

Builds take a while. Do not proceed until the release exists and the workflows are green.

## 4. Write the release notes

Update the GitHub release body with release notes (`gh release edit <tag> --notes-file ...`).

The workflow creates the release as a **prerelease**; publishing the notes is also the moment to promote it:
`gh release edit <tag> --notes-file <file> --prerelease=false --latest`.

Look at the commits since the previous tag (`git log <prev-tag>..<tag> --oneline`) and at the bodies of the last few
releases (`gh release view <tag>`) to stay consistent in tone and format:

- Sections used in past releases: `## ✨ Features` and `## 🐛 Bug Fixes` (omit an empty section).
- End with the changelog link: `**Full Changelog**: https://github.com/seed-hypermedia/seed/compare/<prev-tag>...<tag>`
- Be very short when describing new features. A feature may span 10 commits but is worth only one entry. Group related
  commits into a single user-facing line.
- Do not write notes for fixes to regressions that were introduced and fixed within the same release cycle — the bug was
  never in a released version, so users never saw it. When in doubt, check whether the buggy commit is reachable from
  the previous release tag.
- Write for users, not developers: describe the visible behavior, not the implementation. Internal-only changes
  (refactors, CI, tests) are usually not worth an entry.

## 5. Publish latest.json

Manually run the `Generate latest.json (prod)` workflow so desktop auto-update picks up the new version:

```sh
gh workflow run "Generate latest.json (prod)"
```

### Desktop update integrity and browser policy

Both latest.json workflows hash the published assets before uploading the manifest. Each asset has `sha256` for
`download_url`; macOS also has `zip_sha256` for `zip_url` (the ZIP is the asset the updater installs). A mismatch aborts
installation and removes the download. Missing hashes remain compatible with older manifests.

`signature` is a base64 Ed25519 signature over UTF-8 canonical JSON with only the top-level signature field removed:
recursively sort object keys in UTF-16 order, preserve array order, and use JSON.stringify string/number encoding
without whitespace. The app verifies the original JSON, including unknown fields, before using update or browser policy
data. A bad signature with a configured key aborts the update.

During rollout `UPDATE_SIGNATURE_REQUIRED` is false. Unsigned manifests log a warning and work as before.
`PROD_UPDATE_PUBLIC_KEY` is deliberately empty: even signed production manifests skip verification with a warning until
this key is populated. The committed dev key is a generated bootstrap public key, with no retained private key; tests
generate ephemeral keypairs in memory. Before signing real dev releases, replace it with a keypair controlled by the
release operator.

Generate a separate Ed25519 keypair for each channel on a trusted operator machine:

```sh
openssl genpkey -algorithm ED25519 -out update-prod-private.pem
openssl pkey -in update-prod-private.pem -pubout -out update-prod-public.pem
gh secret set UPDATE_SIGNING_PRIVATE_KEY_PROD < update-prod-private.pem
```

Commit only the public PEM as `PROD_UPDATE_PUBLIC_KEY` in `frontend/apps/desktop/src/update-signing.ts`. For dev use
`DEV_UPDATE_PUBLIC_KEY` and the `UPDATE_SIGNING_PRIVATE_KEY_DEV` GitHub secret. Keep private keys in the release key
vault, never Git. Ship matching public keys to clients before enabling signing. The signing script refuses mismatched
keys or failed asset downloads. Until a secret is configured the workflow publishes hashes without a signature and emits
a warning. After both channels and installed clients have migrated, flip `UPDATE_SIGNATURE_REQUIRED` to true to reject
unsigned or unconfigured updates.

To sign an existing manifest manually, export the private PEM as `UPDATE_SIGNING_PRIVATE_KEY` and run:

```sh
direnv exec . node --experimental-strip-types frontend/apps/desktop/scripts/sign-release-manifest.ts latest.json prod
```

Optional workflow variables `UPDATE_MINIMUM_CHROMIUM_PROD` / `_DEV` supply the `minimumChromium` version string;
`UPDATE_CHROMIUM_RELEASED_AT_PROD` / `_DEV` supply `chromiumReleasedAt` (an ISO 8601 timestamp). These fields are
included in the signature. Leave them unset to retain compatibility without a server minimum. The last accepted policy
is cached across restarts. The browser status is stale when the local Chromium is below the minimum or the bundled
Electron release is older than 60 days. The remote release timestamp never resets the local age. Maintain
`frontend/apps/desktop/electron-release.json` with the Electron pin; tRPC `experiments.getChromiumStatus` exposes this
policy for the integrated-browser branch to consume.
