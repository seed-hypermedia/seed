---
name: Operating an app environment
summary: This page says what you look after when you run an app environment, the server behind Seed agents and apps, and sends you to the right page for setting it up, watching it and repairing it.
---
An [app environment](../software/app-environment.md) is the server that runs [agents](../agent.md) and [apps](../app.md). This page says what you are looking after and sends you to the page for each task. It holds no reference material itself.

If something is broken right now, go to [troubleshooting](./troubleshooting.md). The first thing to check is always `curl <server>/api/health`.

# What you are running

One process, one thread, one SQLite file. The server does four things:

- It answers the [signed API](../build/signed-api.md) and a WebSocket.
- It runs the agents' model turns and scripts.
- It polls for the events that fire [triggers](../trigger.md).
- It keeps all of its own state in a database on local disk, plus one directory per agent for that agent's memory.

It has no pages for a browser. People use it through the Seed [desktop app](../software/desktop.md) and the [web app](../software/web.md).

Around it the server needs:

- an HM server to read and write [documents](../protocol/documents.md) through. This is a [site](../protocol/sites.md), a desktop app's local API, or a public gateway;
- a reverse proxy for TLS, when people reach it over a network;
- optionally, two helper containers for web search and for reading web pages with a browser;
- optionally, hardware virtualization on the host, so agents can run code.

Model provider keys are not part of its configuration. Each [account](../protocol/identity.md) stores its own keys through the signed API; see [model providers](../agent/model-providers.md).

# Reading order

1. [Environments](./environments.md), to find the setup you have.
2. [Configuration](./configuration.md) and [deploying](./deploying.md), to start the server.
3. [Endpoints and health](./endpoints-and-health.md), to check it.
4. [Troubleshooting](./troubleshooting.md), when something is wrong.

The other pages are reference. Read them when you need them.

# Pages

Setting up:

- [Environments](./environments.md): the five setups and the settings each one uses.
- [Self-hosting an app environment](./self-hosted-app-environment.md): the decisions for running the image on your own server.
- [Configuration](./configuration.md): every environment variable and flag.
- [Deploying](./deploying.md): the image, its version metadata, the CI workflows, and rollouts.
- [Web research backends](./web-research-backends.md): the SearXNG and Crawl4AI containers.
- [Code execution backend](./code-execution-backend.md): what the host needs for sandboxes, and how to check them.

Watching:

- [Endpoints and health](./endpoints-and-health.md): every path, the base URL shapes, and the health, version, timing and metrics endpoints.
- [Logs](./logs.md): log levels and the list of log lines.
- [Startup and shutdown](./startup-and-shutdown.md): the start order, the background tasks, the stop order.
- [Run queue](./run-queue.md): how many runs execute at once, restarts, retries, and when the queue pauses.

Looking after the data:

- [Persistence](./persistence.md): the database schema, table by table, and the files on disk.
- [Database retention](./database-retention.md): what keeps the file from growing forever, and how to shrink it.

Repairing:

- [Troubleshooting](./troubleshooting.md): starts from what you see.
- [Debugging runs](./debugging-runs.md): stuck sessions, parents that never resume, scripts that fail.
- [Diagnosing a stalled server](./stalled-server.md): a server that is up but does not answer.

# See also

- [Running Seed](../operate.md), the hub for everything an operator runs
- [App environment](../software/app-environment.md), the program map
- [How agents work](../agent/how-it-works.md), the system from the inside
- [Security](../agent/security.md), the trust boundaries an operator relies on
- [Development](../contribute/development.md) and [testing the app environment](../contribute/testing-the-app-environment.md), for people changing the code
