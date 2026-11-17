---
name: Package publishing
summary: How the npm packages of the Seed repository, the SDK, the CLI, the agents UI and the UI components, are versioned, validated and published by GitHub Actions without a manual step.
---
The Seed repository publishes four packages to npm. None of them waits for a [release](./releasing.md): a GitHub Actions workflow publishes each one, and for three of them a merge to `main` that touches the package is enough. This page says which workflow owns which package, how the version is chosen, and what is checked before the upload.

# The packages

| Package | Source | Workflow | Published when |
| --- | --- | --- | --- |
| `@seed-hypermedia/client`, the [SDK](../build/sdk.md) | `frontend/packages/client` | `publish-client.yml` (`Publish npm packages`) | a push to `main` changes its `src/` or `package.json` |
| `@seed-hypermedia/cli`, the [Seed CLI](../build/cli.md) | `frontend/apps/cli` | `publish-client.yml` | a push to `main` changes its `src/`, `package.json`, `README.md` or `man/` |
| `@seed-hypermedia/apps-ui`, the [agents UI](../build/apps-ui.md) | `frontend/packages/apps-ui` | `agents-ui.yml` (`Agents UI package`) | a push to `main` changes the package or what it bundles |
| `@seed-hypermedia/ui`, built from the workspace package `@shm/ui` | `frontend/packages/ui` | `publish-ui.yml` (`Publish UI package`) | a maintainer runs the workflow on `main` with the publish input set and the exact version to publish |

`publish-client.yml` and `agents-ui.yml` can also be started by hand from the Actions tab. A manual run on `main` uses the same process as an automatic one.

# How the version is chosen

For the SDK, the CLI and the agents UI, the version in `package.json` is a floor, and npm holds the real number. The workflow reads the latest version on npm before it builds:

- If the package was never published, the checked-in version is used.
- If the checked-in version is higher than the one on npm, it is used. This is how a maintainer makes a minor or major bump: edit `package.json` in the pull request.
- Otherwise the workflow increments the patch number of the npm version.

So the npm version of these packages is normally ahead of the number in the repository, and nobody commits version bumps for ordinary changes.

`@seed-hypermedia/ui` works differently. Its version is the one checked in, and the manual run must name that exact version or it stops.

# What is checked before publishing

Every workflow builds the package, packs it, and installs the packed tarball in a clean npm project before it publishes. The SDK check imports the entry point and the subpath modules. The CLI check compares the built binary's version with the chosen one, rejects a tarball that still names `workspace:` dependencies, and runs the installed binary. For the agents UI the version is selected before building, and for both UI packages the upload is the exact tarball that was tested. <!-- id:n56wV3sl -->

The `Agents UI package` workflow also runs on pull requests, where it validates and does not publish. It watches `frontend/packages/apps-ui` and what the package bundles: `frontend/packages/ui`, `shared`, `client` and `editor`, and `apps/protocol`. `Publish UI package` validates pull requests that touch `frontend/packages/ui` the same way.

# Credentials

`publish-client.yml` publishes with npm trusted publishing: the job has `id-token: write` and no npm token. The two UI workflows publish with provenance and read an npm token from the repository secret `UI_NPM_TOKEN`. They stop with a message when the secret is missing.

# See also

- [Releasing](./releasing.md), for the desktop app, the Docker images and the production docs.
- [Embedding the agents UI](../build/apps-ui.md), [SDK](../build/sdk.md) and [Seed CLI](../build/cli.md), the packages from the user's side.
- [Contributing](./contributing.md), for the tests to run before a merge.
- [Working on Seed](../contribute.md), the list of contributor guides.
