---
name: Working on Seed
summary: The guides for people who change the Seed repository itself, covering setup and tests, editing these docs, local CI, releases, package publishing and the app environment.
---
This section is for people and coding agents who change the Seed repository, [github.com/seed-hypermedia/seed](https://github.com/seed-hypermedia/seed). It holds the [daemon](./software/daemon.md), the apps, the [app environment](./software/app-environment.md), the [vault](./software/vault.md), the deployment tooling and the markdown for this site. If you want to use Seed without changing it, read [Building on Hypermedia](./build.md). If you want to run it, read [Running Seed](./operate.md).

Read [Contributing](./contribute/contributing.md) first. It gets the repository running and names the checks every change needs. The other pages each cover one job.

# Setup and checks

- [Contributing](./contribute/contributing.md) maps the repository, sets up the toolchain, runs the development stack, lists the checks for each area, and states the rules for storage migrations, protobuf and protocol changes.
- [Local CI with agent-ci](./contribute/local-ci.md) runs the GitHub Actions workflows on your own machine before you push. Read it when a check fails only in CI, or to shorten the loop.
- [Editing these docs](./contribute/editing-these-docs.md) explains the `hypermedia/` folder, the checks it must pass, the local editing loop, and when a change reaches the published site.

# Shipping

- [Releasing](./contribute/releasing.md) is the maintainer's runbook for a production release: version, tag, build, release notes, auto-update.
- [Package publishing](./contribute/package-publishing.md) explains how the npm packages (the SDK, the CLI and the agents UI) publish themselves from `main`.
- [Sentry](./contribute/sentry.md) says which Sentry project each program reports to, where each setting lives in code, and how to find an error.

# The app environment

- [Development](./contribute/development.md) is the contributor guide to the server that runs [Seed Agents](./agent.md): commands, local URLs, conventions and step lists for the common changes.
- [Code map](./contribute/code-map.md) says which file holds what in the app environment and its shared UI, and which test file covers it.
- [Testing the app environment](./contribute/testing-the-app-environment.md) covers its test suites and gates.

# See also

- [The Seed software](./software.md), one map page per program in the repository.
- [The Hypermedia Protocol](./protocol.md), the concepts the code implements.
- [Building on Hypermedia](./build.md), for the public surfaces.
- [Running Seed](./operate.md), for deployment and operations.

# Pages in this section <!-- id:fL4vGICX attrs:{"childrenType":"Grid","columnCount":3} -->

<./contribute/contributing.md> <!-- id:Or90kn31 type:Embed attrs:{"view":"Card"} -->

<./contribute/editing-these-docs.md> <!-- id:jDpz0LUd type:Embed attrs:{"view":"Card"} -->

<./contribute/local-ci.md> <!-- id:hQT6otZC type:Embed attrs:{"view":"Card"} -->

<./contribute/releasing.md> <!-- id:xBOWhT94 type:Embed attrs:{"view":"Card"} -->

<./contribute/package-publishing.md> <!-- id:CQKDMFsq type:Embed attrs:{"view":"Card"} -->

<./contribute/sentry.md> <!-- id:BvJvPFaD type:Embed attrs:{"view":"Card"} -->

<./contribute/development.md> <!-- id:8hGAuRoc type:Embed attrs:{"view":"Card"} -->

<./contribute/code-map.md> <!-- id:DypeGOBB type:Embed attrs:{"view":"Card"} -->

<./contribute/testing-the-app-environment.md> <!-- id:058jqEX5 type:Embed attrs:{"view":"Card"} -->
