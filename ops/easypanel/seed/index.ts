import { Output, randomPassword, Services } from "~templates-utils";
import { Input } from "./meta";

export function generate(input: Input): Output {
  const linkSecret = randomPassword();
  const baseUrl = `https://${input.domain}`;
  const daemonServiceName = input.daemonServiceName ?? "daemon";
  const webServiceName = input.webServiceName ?? "web";
  const updaterServiceName = input.updaterServiceName ?? "updater";
  const p2pPort = input.p2pPort ?? 56000;
  const siteImage = input.siteImage ?? "seedhypermedia/site:latest";
  const webImage = input.webImage ?? "seedhypermedia/web:latest";
  const updateInterval = input.updateInterval ?? 600;
  const daemonCommand = `seed-daemon -data-dir=/data -keystore-dir=/data/keys -lndhub.mainnet -p2p.port=56000 -http.port=56001 -grpc.port=56002 -p2p.no-relay=true -p2p.force-reachability-public=true -syncing.smart=true -syncing.no-sync-back=true -p2p.announce-addrs=/dns4/${input.domain}/tcp/${p2pPort},/dns4/${input.domain}/udp/${p2pPort}/quic-v1`;
  const webCommand = String.raw`sh -c 'if [ -z "$SEED_LINK_SECRET" ] || [ "$SEED_LINK_SECRET" = "REPLACE_WITH_SECRET" ]; then echo "SEED_LINK_SECRET must be set to a unique secret before starting Seed web." >&2; exit 1; fi; if [ ! -f /data/config.json ]; then printf "{\"availableRegistrationSecret\":\"%s\"}\n" "$SEED_LINK_SECRET" > /data/config.json; fi; exec npm run start:prod'`;

  const services: Services = [
    {
      type: "app",
      data: {
        serviceName: daemonServiceName,
        source: { type: "image", image: siteImage },
        env: [
          "SEED_LOG_LEVEL=info",
          "LIGHTNING_API_URL=https://ln.seed.hyper.media",
          "SENTRY_DSN=https://47c66bd7a6d64db68a59c03f2337e475@o4504088793841664.ingest.sentry.io/4505527493328896",
        ].join("\n"),
        deploy: { command: daemonCommand },
        ports: [
          { published: p2pPort, target: 56000, protocol: "tcp" },
          { published: p2pPort, target: 56000, protocol: "udp" },
        ],
        mounts: [{ type: "volume", name: "data", mountPath: "/data" }],
        domains: [{ host: input.domain, port: 56001, path: "/ipfs/" }],
      },
    },
    {
      type: "app",
      data: {
        serviceName: webServiceName,
        source: { type: "image", image: webImage },
        env: [
          `SEED_BASE_URL=${baseUrl}`,
          `SEED_ASSET_HOST=${baseUrl}`,
          `DAEMON_HTTP_URL=http://$(PROJECT_NAME)_${daemonServiceName}:56001`,
          `SEED_LINK_SECRET=${linkSecret}`,
          "NOTIFY_SERVICE_HOST=https://notify.seed.hyper.media",
          "SEED_IS_GATEWAY=false",
          "SEED_ENABLE_STATISTICS=false",
          "PORT=3000",
          "DATA_DIR=/data",
        ].join("\n"),
        deploy: { command: webCommand },
        mounts: [{ type: "volume", name: "data", mountPath: "/data" }],
        domains: [{ host: input.domain, port: 3000 }],
      },
    },
    {
      type: "app",
      data: {
        serviceName: updaterServiceName,
        source: { type: "image", image: "containrrr/shepherd:v1.8.1" },
        env: [
          `SLEEP_TIME=${updateInterval}s`,
          "FILTER_SERVICES=name=$(PROJECT_NAME)_",
          `IGNORELIST_SERVICES=$(PROJECT_NAME)_${updaterServiceName}`,
          "ROLLBACK_ON_FAILURE=true",
        ].join("\n"),
        mounts: [
          {
            type: "bind",
            hostPath: "/var/run/docker.sock",
            mountPath: "/var/run/docker.sock",
          },
        ],
      },
    },
  ];

  return { services };
}
