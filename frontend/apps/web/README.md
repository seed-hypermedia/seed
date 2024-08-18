## Dev

To run the dev site service:

```
yarn dev
```

To run the site daemon:

```
SEED_P2P_TESTNET_NAME="dev" go run ./backend/cmd/seed-daemon -data-dir="$HOME/.seed-site" -p2p.port=59000  -grpc.port=59002 -http.port=59001
```

set `config.json` to:

```
{"availableRegistrationSecret": "abc"}
```

then go into the app and publish your account with this URL:

```
http://localhost:5175/hm/register?secret=abc
```

For web deployment in production

```
sh <(curl -sL https://raw.githubusercontent.com/seed-hypermedia/seed/main/website_deployment.sh) https://seed.verse.link --tag main --auto-update
```
