## Local Monitoring

This is a simple local monitoring setup for the running Seed application.

It's WIP, and will change quite a bit.

The provisioned Grafana dashboards are copied from the upstream libp2p repository, flattenning the hierarchy to make it easier to navigate.

To update the dashborads, from the root of the repository run `./monitoring/vendor-libp2p-dashboards.sh`.

## Getting Started

Make sure to have Docker available on your machine. For macOS you probably want to use [Orb](https://orbstack.dev) instead of Docker Desktop, because it's much faster and nicer to use.

1. From the root of the repository run `docker compose -f ./monitoring/docker-compose.yaml up -d`.
2. Open http://localhost:3001 in your browser. It might take a while before Grafana is ready to use.

You may see occasional "Unauthorized" error banner, but it can be safely ignored. There seems to be a [bug in Grafana](https://github.com/grafana/grafana/issues/93455).
