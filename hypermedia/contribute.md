---
name: Working on Seed
summary: This section holds the guides for people who change the Seed repository, and it covers setup and tests, editing these docs, local CI, releases, package publishing and the app environment.
---
This section is for people and coding agents who change the code of Seed. All the code is in one repository, [github.com/seed-hypermedia/seed](https://github.com/seed-hypermedia/seed). The repository holds the [daemon](./software/daemon.md), the apps, the [app environment](./software/app-environment.md), the [vault](./software/vault.md), the deployment tools and the markdown for this [site](./protocol/sites.md).

Pick the section that fits what you want to do:

- To change Seed, stay here.
- To use Seed from your own code without changing it, read [Building on Hypermedia](./build.md).
- To run Seed on a server, read [Running Seed](./operate.md).

Start with [Contributing](./contribute/contributing.md). It gets the repository running on your machine and names the checks every change needs. Each of the other pages covers one job.

# Setup and checks

- [Contributing](./contribute/contributing.md) shows the layout of the repository, the setup, the development stack and the checks for each area. It also has the rules for storage migrations, protobuf and protocol changes.
- [Local CI with agent-ci](./contribute/local-ci.md) runs the GitHub Actions workflows on your own machine before you push. Read it when a check fails only in CI, or when you want a faster loop.
- [Editing these docs](./contribute/editing-these-docs.md) explains the `hypermedia/` folder, the checks it must pass, how to edit it locally, and when a change reaches the published site.

# Shipping

- [Releasing](./contribute/releasing.md) is the maintainer's list of steps for a production release: version, tag, build, release notes, auto-update.
- [Package publishing](./contribute/package-publishing.md) explains how GitHub Actions publishes the four npm packages: the [SDK](./build/sdk.md), the [CLI](./build/cli.md), the agents UI and the UI components.
- [Sentry](./contribute/sentry.md) says which Sentry project each program reports errors to, where each setting is in the code, and how to find an error.

# The app environment

- [Development](./contribute/development.md) is the guide to changing the server that runs [Seed Agents](./agent.md): commands, local URLs, conventions and step lists for the common changes.
- [Code map](./contribute/code-map.md) says which file holds what in the app environment and its shared UI, and which test file covers it.
- [Testing the app environment](./contribute/testing-the-app-environment.md) covers its test suites and gates.

# See also

- [The Seed software](./software.md), one map page for each program in the repository.
- [The Hypermedia Protocol](./protocol.md), the concepts the code implements.
- [Building on Hypermedia](./build.md), for the public APIs and tools.
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
