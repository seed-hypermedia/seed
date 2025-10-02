## Local Monitoring

This is a simple local monitoring setup for the running Seed application.

It's WIP, and will change quite a bit.

The provisioned Grafana dashboards are copied from the upstream libp2p repository, flattenning the hierarchy to make it easier to navigate.

To update the dashborads, _from the root of the repository_ run `./monitoring/vendor-libp2p-dashboards.sh`.

## Getting Started

Make sure to have Docker available on your machine. You can use whatever Docker distribution you want. For macOS I recommend using [Orb](https://orbstack.dev) instead of Docker Desktop, because it's much faster and nicer to use. But it's not necessary, any Docker installation will do.

1. _From the root of the repository_ run `docker compose -f ./monitoring/docker-compose.yaml up -d`.
2. Open http://localhost:3001 in your browser. It might take a while before Grafana is ready to use.

You may see occasional "Unauthorized" error banner, but it can be safely ignored. There seems to be a [bug in Grafana](https://github.com/grafana/grafana/issues/93455).
