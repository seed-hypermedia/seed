---
name: Running Seed
summary: This is the starting page for people who run Seed software for others, and it says what you can run, which page to read first, and what each operations page is for.
---
Welcome. This section is for people who run Seed software for others: a site, an app environment, or the services beside them. It says what you can run, which page to read first, and what each page is for. If you only want to use Seed, you do not need any of this.

Is something broken right now? Go to [troubleshooting](./operate/troubleshooting.md) for an app environment, to `seed-deploy doctor` in [self-hosting](./operate/self-hosting.md#day-to-day) for a site, or to [daemon operations](./operate/daemon-operations.md) for a slow daemon.

# What can be run

- **A site.** A site shows one [space](./protocol/spaces.md) at a web domain. It is a [daemon](./software/daemon.md) and a [web app](./software/web.md) behind a reverse proxy. This is what most operators run. [Sites](./protocol/sites.md) explains what a site is in the protocol.
- **An app environment.** The server that runs [agents](./agent.md) and [apps](./app.md). It can run beside a site, alone, or inside the [desktop app](./software/desktop.md). See the [app environment](./software/app-environment.md) program map.
- **The vault.** The service that keeps the keys of people's [accounts](./protocol/identity.md) and signs them in. A site uses the hosted vault, unless it is an enterprise node. See the [vault](./software/vault.md) program map.
- **Notify.** The service that keeps notification inboxes and sends email. A site uses the hosted one, unless it is an enterprise node. See the [notify](./software/notify.md) program map.

The [software](./software.md) section has one map page for each program. It says where the code is, what the program listens on, and how you configure it.

# Reading order

1. [Self-hosting](./operate/self-hosting.md), to set up a site and learn the `seed-deploy` command.
2. [Publishing a space to a domain](./operate/publishing-to-a-domain.md) and [custom domains](./operate/custom-domains.md), to give it an address.
3. [Operations](./operate/operations.md), if the site runs an app environment or you run one alone. It leads to every app environment page.
4. [Troubleshooting](./operate/troubleshooting.md), when something is wrong.

If you are setting up a closed node for one organization, read the [enterprise node](./operate/enterprise-node.md) page in place of step 2.

# Sites

- [Self-hosting](./operate/self-hosting.md): install a site with the deploy script, register a space, update and back up the node.
- [Enterprise node](./operate/enterprise-node.md): the deploy script's second setup, for invited people only and cut off from the public network.
- [Running an invite-only vault](./operate/invite-only-vault.md): invitations and the admin API of the vault on an enterprise node.
- [Publishing a space to a domain](./operate/publishing-to-a-domain.md): the owner's steps for giving a space a web address.
- [Custom domains](./operate/custom-domains.md): the DNS side of serving a site at your own domain, and moving a node to a new hostname.
- [Daemon operations](./operate/daemon-operations.md): a daemon that is slow or uses too much memory.
- [Daemon network reference](./operate/daemon-network.md): ports, flags, relays and debug pages of the daemon's network layer.

# App environment

- [Operations](./operate/operations.md): the overview, and the way to every page below.
- [Environments](./operate/environments.md): the five setups and the settings each one uses.
- [Self-hosting an app environment](./operate/self-hosted-app-environment.md): running the image on your own server.
- [Configuration](./operate/configuration.md): every environment variable and flag.
- [Deploying](./operate/deploying.md): the image, its version metadata, the CI workflows, and rollouts.
- [Endpoints and health](./operate/endpoints-and-health.md): every path, and the health, version, timing and metrics endpoints.
- [Web research backends](./operate/web-research-backends.md): the helper containers behind web search and web reads through a browser.
- [Code execution backend](./operate/code-execution-backend.md): what the host needs for sandboxes, and how to check them.
- [Run queue](./operate/run-queue.md): how many runs execute at once, restarts, retries, and when the queue pauses.
- [Startup and shutdown](./operate/startup-and-shutdown.md): the start order, the background tasks, the stop order.
- [Logs](./operate/logs.md): log levels and the list of log lines.
- [Persistence](./operate/persistence.md): the database schema, table by table.
- [Database retention](./operate/database-retention.md): what keeps the database from growing forever, and how to shrink it.
- [Troubleshooting](./operate/troubleshooting.md): starts from what you see.
- [Debugging runs](./operate/debugging-runs.md): runs that are stuck, lost or failing.
- [Diagnosing a stalled server](./operate/stalled-server.md): a server that is up but does not answer.

# See also

- [Software](./software.md), what each program is
- [Agents](./agent.md), how the things an app environment runs work
- [Build](./build.md), the APIs these servers answer
- [Contribute](./contribute.md), working on the code, including [testing the app environment](./contribute/testing-the-app-environment.md)

# Sites and nodes <!-- id:mjcqe8r1 attrs:{"childrenType":"Grid","columnCount":3} -->

<./operate/self-hosting.md> <!-- id:G2y8A9lR type:Embed attrs:{"view":"Card"} -->

<./operate/enterprise-node.md> <!-- id:1b4QN8wc type:Embed attrs:{"view":"Card"} -->

<./operate/custom-domains.md> <!-- id:f0He83sg type:Embed attrs:{"view":"Card"} -->

<./operate/publishing-to-a-domain.md> <!-- id:DSpnEHk7 type:Embed attrs:{"view":"Card"} -->

<./operate/invite-only-vault.md> <!-- id:CKxmVckV type:Embed attrs:{"view":"Card"} -->

<./operate/daemon-operations.md> <!-- id:epTQBuCt type:Embed attrs:{"view":"Card"} -->

<./operate/daemon-network.md> <!-- id:Bm5pH0Pi type:Embed attrs:{"view":"Card"} -->

# Running an app environment <!-- id:PS7yE7hx attrs:{"childrenType":"Grid","columnCount":3} -->

<./operate/operations.md> <!-- id:646Oqs8z type:Embed attrs:{"view":"Card"} -->

<./operate/environments.md> <!-- id:6EAKXTDm type:Embed attrs:{"view":"Card"} -->

<./operate/self-hosted-app-environment.md> <!-- id:LuG2l6r6 type:Embed attrs:{"view":"Card"} -->

<./operate/configuration.md> <!-- id:jSAy2pX1 type:Embed attrs:{"view":"Card"} -->

<./operate/deploying.md> <!-- id:984lvuLD type:Embed attrs:{"view":"Card"} -->

<./operate/endpoints-and-health.md> <!-- id:fZU0C3Vw type:Embed attrs:{"view":"Card"} -->

<./operate/startup-and-shutdown.md> <!-- id:DVswHogp type:Embed attrs:{"view":"Card"} -->

<./operate/run-queue.md> <!-- id:xjRHAbNL type:Embed attrs:{"view":"Card"} -->

<./operate/code-execution-backend.md> <!-- id:D9akp8Sn type:Embed attrs:{"view":"Card"} -->

<./operate/web-research-backends.md> <!-- id:ExS05gxu type:Embed attrs:{"view":"Card"} -->

<./operate/persistence.md> <!-- id:vQR326x4 type:Embed attrs:{"view":"Card"} -->

<./operate/database-retention.md> <!-- id:zozFJFrC type:Embed attrs:{"view":"Card"} -->

<./operate/logs.md> <!-- id:wqiaL8yQ type:Embed attrs:{"view":"Card"} -->

# When something is wrong <!-- id:GOiM40M8 attrs:{"childrenType":"Grid","columnCount":3} -->

<./operate/troubleshooting.md> <!-- id:JMq4vYO0 type:Embed attrs:{"view":"Card"} -->

<./operate/debugging-runs.md> <!-- id:ybAHWkgh type:Embed attrs:{"view":"Card"} -->

<./operate/stalled-server.md> <!-- id:CKosPwhr type:Embed attrs:{"view":"Card"} -->
