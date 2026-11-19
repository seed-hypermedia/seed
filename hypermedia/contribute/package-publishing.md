---
name: Package publishing
summary: This page explains how GitHub Actions gives a version to, checks and publishes the four npm packages of the Seed repository, which are the SDK, the CLI, the agents UI and the UI components.
---
The Seed repository publishes four packages to npm, so that other people can install Seed code in their own projects. A GitHub Actions workflow publishes each one. None of them waits for a [release](./releasing.md) of the [desktop app](../software/desktop.md). For three of them, a merge to `main` that changes the package is enough. The fourth needs a maintainer to start its workflow.

This page says which workflow publishes which package, how the version is chosen, and what is checked before the upload.

# The packages

| Package | Source | Workflow | Published when |
| --- | --- | --- | --- |
| `@seed-hypermedia/client`, the [SDK](../build/sdk.md) | `frontend/packages/client` | `publish-client.yml` (`Publish npm packages`) | a push to `main` changes its `src/` or `package.json` |
| `@seed-hypermedia/cli`, the [Seed CLI](../software/cli.md) | `frontend/apps/cli` | `publish-client.yml` | a push to `main` changes its `src/`, `package.json`, `README.md` or `man/` |
| `@seed-hypermedia/apps-ui`, the [agents UI](../build/apps-ui.md) | `frontend/packages/apps-ui` | `agents-ui.yml` (`Agents UI package`) | a push to `main` changes the package or what it bundles |
| `@seed-hypermedia/ui`, the UI components, built from the workspace package `@shm/ui` (see [The shared packages](../software/packages.md)) | `frontend/packages/ui` | `publish-ui.yml` (`Publish UI package`) | a maintainer runs the workflow on `main` with the publish input set and the exact version to publish |

You can also start `publish-client.yml` and `agents-ui.yml` by hand from the Actions tab. A run that you start by hand on `main` works the same way as an automatic one.

# How the version is chosen

For the SDK, the CLI and the [agents](../agent.md) UI, the version in `package.json` is only a minimum. npm holds the real number. The workflow reads the latest version on npm before it builds:

- If the package was never published, the version in the repository is used.
- If the version in the repository is higher than the one on npm, it is used. This is how a maintainer raises the minor or major number: edit `package.json` in the pull request.
- In every other case, the workflow adds one to the patch number of the npm version.

So the npm version of these packages is normally higher than the number in the repository, and nobody commits a new version number for an ordinary change.

`@seed-hypermedia/ui` works differently. Its version is the one in the repository. The run that a maintainer starts must name that exact version, or it stops.

# What is checked before publishing

Before it publishes, every workflow builds the package, packs it into a tarball, and installs that tarball in a clean npm project. Each package also has its own checks: <!-- id:n56wV3sl -->

- **The SDK.** The check imports the entry point and the subpath modules.
- **The CLI.** The check compares the version of the built binary with the chosen version. It rejects a tarball that still names `workspace:` dependencies. It runs the installed binary.
- **The agents UI.** The workflow chooses the version before it builds.
- **Both UI packages.** The upload is the exact tarball that was tested.

The `Agents UI package` workflow also runs on pull requests. There it checks the package and does not publish. It watches `frontend/packages/apps-ui` and what the package bundles: `frontend/packages/ui`, `shared`, `client` and `editor`, and `apps/protocol`. `Publish UI package` checks pull requests that change `frontend/packages/ui` in the same way.

# Credentials

`publish-client.yml` uses npm trusted publishing: the job has `id-token: write` and needs no npm token. The two UI workflows publish with provenance, and they read an npm token from the repository secret `UI_NPM_TOKEN`. They stop with a message when the secret is missing.

# See also

- [Releasing](./releasing.md), for the desktop app, the Docker images and the production docs.
- [Embedding the agents UI](../build/apps-ui.md), [SDK](../build/sdk.md) and [CLI reference](../build/cli.md), the packages from the user's side.
- [Contributing](./contributing.md), for the tests to run before a merge.
- [Working on Seed](../contribute.md), the list of contributor guides.
