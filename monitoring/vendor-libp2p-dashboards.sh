#!/usr/bin/env sh

cd "$(git rev-parse --show-toplevel)"

# Making sure Go dependencies are up to date, because we take the dashboards
# from the same version of libp2p that we are using.
go mod tidy

LIBP2P_ROOT="$(go list -m -f '{{.Dir}}' github.com/libp2p/go-libp2p)"
SCRIPT_ROOT="$(dirname $0)"
DST_DIR="$SCRIPT_ROOT/grafana/dashboards/libp2p"

rm -f $DST_DIR/*.json
cp $LIBP2P_ROOT/dashboards/*/*.json $DST_DIR
