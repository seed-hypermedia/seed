---
name: Operating an app environment
summary: An overview of running an app environment, the server behind Seed agents and apps, with a route to each task page for configuring, deploying, watching and repairing it.
---
An [app environment](../software/app-environment.md) is the server that runs [agents](../agent.md) and [apps](../app.md). This page says what an operator is looking after and points to the page for each task. It holds no reference material itself.

# What you are running

One process, one thread, one SQLite file. The server answers a signed API and a WebSocket, runs the agents' model turns and scripts, polls for the events that fire [triggers](../agent/triggers.md), and keeps all of its own state in a database on local disk, plus one directory per agent for its memory. It has no browser UI. People use it through the Seed desktop and web apps.

Around it the server needs:

- an HM server to read and write documents through, which is a [site](../protocol/sites.md), a desktop app's local API, or a public gateway;
- a reverse proxy for TLS, when it is reached over a network;
- optionally, two sidecars for web search and browser-rendered reads;
- optionally, hardware virtualization on the host, so agents can run code.

Model provider keys are not part of its configuration. Each account stores its own through the signed API; see [model providers](../agent/model-providers.md).

# Reading order

Read [environments](./environments.md) first to find the kind of deployment you have. Then [configuration](./configuration.md) and [deploying](./deploying.md) to stand it up, [endpoints and health](./endpoints-and-health.md) to check it, and [troubleshooting](./troubleshooting.md) when something is wrong. The rest is reference for when you need it.

# Pages

Setting up:

- [Environments](./environments.md): the five kinds of deployment and the settings each one uses.
- [Self-hosting an app environment](./self-hosted-app-environment.md): the decisions for running the image on your own server.
- [Configuration](./configuration.md): every environment variable and flag.
- [Deploying](./deploying.md): the image, its version metadata, the CI workflows, and rollouts.
- [Web research backends](./web-research-backends.md): the SearXNG and Crawl4AI sidecars.
- [Code execution backend](./code-execution-backend.md): what the host needs for sandboxes, and how to check them.

Watching:

- [Endpoints and health](./endpoints-and-health.md): every path, the base URL shapes, and the health, version, timing and metrics endpoints.
- [Logs](./logs.md): log levels and the catalogue of log lines.
- [Startup and shutdown](./startup-and-shutdown.md): the boot order, the background tasks, the stop order.
- [Run queue](./run-queue.md): concurrency caps, restarts, retries, and when dispatch pauses.

Looking after the data:

- [Persistence](./persistence.md): the database schema, table by table, and the files on disk.
- [Database retention](./database-retention.md): what bounds the file's growth, and how to shrink it.

Repairing:

- [Troubleshooting](./troubleshooting.md): symptom first.
- [Debugging runs](./debugging-runs.md): stuck sessions, parents that never resume, scripts that fail.
- [Diagnosing a stalled server](./stalled-server.md): a server that is up but does not answer.

# See also

- [Running Seed](../operate.md), the hub for everything an operator runs
- [App environment](../software/app-environment.md), the program map
- [How agents work](../agent/how-it-works.md), the system from the inside
- [Security](../agent/security.md), the trust boundaries an operator relies on
- [Development](../contribute/development.md) and [testing the app environment](../contribute/testing-the-app-environment.md), for people changing the code
