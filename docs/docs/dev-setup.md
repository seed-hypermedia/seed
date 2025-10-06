# Developer Setup

> Checkout the [Build System Document](./build-system.md)

## Building on Unix-Like Systems

The development setup is simplified and automated by using the [Mise](https://mise.jdx.dev), and [Direnv](https://direnv.net). You should use this setup on Unix-like systems, instead of trying to manually install the required tools.

### Prerequisites

You must have the C toolchain installed globally on your machine. It can be `gcc` or `clang` with their corresponding linkers.

### Install Direnv

[Direnv](https://direnv.net) is used to configure the development environment when you open up the project directory. It's useful because it makes configuration portable between developers, and won't pollute your global environment.

In theory because we use mise we don't really need direnv, but direnv is more widespread and has better support in different IDEs than mise, so we activate the mise environment from within direnv for better compatibility.

Install direnv following the instructions on their website (link above).

IMPORTANT: To complete the setup you must add direnv shell hooks to your shell profile:

```shell
eval "$(direnv hook bash)"  # for bash
eval "$(direnv hook zsh)"   # for zsh
eval (direnv hook fish)     # for fish
```

It's _highly_ recommended to configure your IDE to work with direnv. We have setup the corresponding extension recommendations for VS Code.

### Install System Libraries (Linux Only)

To compile on Linux you might need the following libraries installed, depending on your distribution:

- libgtk-3-dev
- libwebkit2gtk-4.0-dev
- libayatana-appindicator3-dev
- librsvg2-dev
- patchelf

## Building on Windows

Internally, none of us uses Windows for development, but we _do_ build _for_ Windows _on_ Windows machines in CI. You can inspect the corresponding GitHub Actions workflow definitions to find out what needs to be installed to compile the project.

## Running App

To run the app, by default it will run on the test network:

```
./dev run-desktop
```

You can also run against the production network:

```
SEED_P2P_TESTNET_NAME="" ./dev run-desktop
```

In some linux environments, you will require to [increase UDP buffer size](https://github.com/quic-go/quic-go/wiki/UDP-Buffer-Sizes)
for the correct functioning of the app. To do so, just run:

```bash
sysctl -w net.core.rmem_max=7500000
sysctl -w net.core.wmem_max=7500000
```

## Web App Builds

You can build docker images for different modules of the system.

Daemon: `docker build -t seed-daemon . -f ./backend/cmd/seed/Dockerfile`
Frontend: `docker build -t gateway . -f ./frontend/gateway/Dockerfile`

## Dev: Run Site

#### 1. Run the Daemon

You can start the daemon go daemon with:

```
go run ./backend/cmd/seed-site -data-dir=~/.mttsite -p2p.port=59000 --http.port=59001 -p2p.no-relay -grpc.port=59002 http://127.0.0.1:59001
```

### 2. Start the Frontend Web App

In the Seed directory, start by running `yarn`. Then:

```
cd frontend/apps/web
DAEMON_HTTP_URL="http://localhost:57001" yarn dev
```

## Dev: Run Gateway

Run the daemon:

```
SEED_P2P_TESTNET_NAME="dev" go run ./backend/cmd/seed-daemon -data-dir="$HOME/.seed-site" -p2p.port=59000  -grpc.port=59002 -http.port=59001
```

Simultaneously run the Frontend:

```
cd frontend/apps/web
PORT=3300 DAEMON_HTTP_URL="http://localhost:59001" yarn dev
```

Now your dev gateway is running at `http://localhost:3300`

## Debugging JSON-CBOR Blobs

Use this URL:

```
localhost:{your-http-port-or-default-55002/debug/cid/{your-cid}
```
