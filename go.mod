module seed

go 1.24.6

toolchain go1.24.8

require (
	crawshaw.io/iox v0.0.0-20181124134642-c51c3df30797
	github.com/RoaringBitmap/roaring/v2 v2.4.2
	github.com/btcsuite/btcd v0.23.3
	github.com/btcsuite/btcd/btcutil v1.1.2
	github.com/burdiyan/go/mainutil v0.0.0-20200124222818-6f87e0e684b6
	github.com/fxamacker/cbor/v2 v2.7.0
	github.com/getsentry/sentry-go v0.16.0
	github.com/go-viper/mapstructure/v2 v2.2.1
	github.com/google/go-cmp v0.7.0
	github.com/gorilla/mux v1.8.1
	github.com/grafana/pyroscope-go/godeltaprof v0.1.8
	github.com/grpc-ecosystem/go-grpc-middleware/providers/prometheus v1.0.1
	github.com/improbable-eng/grpc-web v0.15.0
	github.com/invopop/validation v0.8.0
	github.com/ipfs/boxo v0.35.0
	github.com/ipfs/go-block-format v0.2.3
	github.com/ipfs/go-cid v0.5.0
	github.com/ipfs/go-datastore v0.9.0
	github.com/ipfs/go-ipld-cbor v0.2.1
	github.com/ipfs/go-ipld-format v0.6.3
	github.com/ipfs/go-log/v2 v2.8.2
	github.com/ipld/go-codec-dagpb v1.7.0
	github.com/ipld/go-ipld-prime v0.21.0
	github.com/jedib0t/go-pretty/v6 v6.5.9
	github.com/klauspost/compress v1.18.0
	github.com/libp2p/go-libp2p v0.44.0
	github.com/libp2p/go-libp2p-gostream v0.6.0
	github.com/libp2p/go-libp2p-kad-dht v0.35.1
	github.com/lightningnetwork/lnd v0.15.1-beta.rc2
	github.com/multiformats/go-multiaddr v0.16.1
	github.com/multiformats/go-multibase v0.2.0
	github.com/multiformats/go-multicodec v0.9.2
	github.com/multiformats/go-multihash v0.2.3
	github.com/peterbourgon/ff/v4 v4.0.0-alpha.4
	github.com/peterbourgon/trc v0.0.3
	github.com/polydawn/refmt v0.89.0
	github.com/prometheus/client_golang v1.23.2
	github.com/sanity-io/litter v1.5.5
	github.com/sethvargo/go-retry v0.2.4
	github.com/shirou/gopsutil/v3 v3.24.1
	github.com/stretchr/testify v1.11.1
	github.com/tidwall/btree v1.7.0
	github.com/tyler-smith/go-bip39 v1.1.0
	github.com/zalando/go-keyring v0.2.5
	go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc v0.25.0
	go.opentelemetry.io/otel v1.38.0
	go.opentelemetry.io/otel/sdk v1.38.0
	go.uber.org/multierr v1.11.0
	go.uber.org/zap v1.27.0
	golang.org/x/exp v0.0.0-20250911091902-df9299821621
	golang.org/x/sync v0.17.0
	golang.org/x/text v0.29.0
	google.golang.org/grpc v1.75.0
	google.golang.org/protobuf v1.36.9
	roci.dev/fracdex v0.0.0-00010101000000-000000000000
	rsc.io/ordered v1.1.1
)

require (
	github.com/Jorropo/jsync v1.0.1 // indirect
	github.com/alessio/shellescape v1.4.1 // indirect
	github.com/bits-and-blooms/bitset v1.12.0 // indirect
	github.com/danieljoos/wincred v1.2.0 // indirect
	github.com/filecoin-project/go-clock v0.1.0 // indirect
	github.com/gammazero/chanqueue v1.1.1 // indirect
	github.com/gammazero/deque v1.1.0 // indirect
	github.com/golang/groupcache v0.0.0-20210331224755-41bb18bfe9da // indirect
	github.com/grpc-ecosystem/go-grpc-middleware v1.4.0 // indirect
	github.com/grpc-ecosystem/go-grpc-middleware/v2 v2.1.0 // indirect
	github.com/ipfs/go-dsqueue v0.0.5 // indirect
	github.com/libp2p/go-libp2p-record v0.3.1 // indirect
	github.com/libp2p/go-yamux/v5 v5.0.1 // indirect
	github.com/mattn/go-runewidth v0.0.16 // indirect
	github.com/mschoch/smat v0.2.0 // indirect
	github.com/munnerz/goautoneg v0.0.0-20191010083416-a7dc8b61c822 // indirect
	github.com/pion/datachannel v1.5.10 // indirect
	github.com/pion/dtls/v2 v2.2.12 // indirect
	github.com/pion/dtls/v3 v3.0.6 // indirect
	github.com/pion/ice/v4 v4.0.10 // indirect
	github.com/pion/interceptor v0.1.40 // indirect
	github.com/pion/logging v0.2.3 // indirect
	github.com/pion/mdns/v2 v2.0.7 // indirect
	github.com/pion/randutil v0.1.0 // indirect
	github.com/pion/rtcp v1.2.15 // indirect
	github.com/pion/rtp v1.8.19 // indirect
	github.com/pion/sctp v1.8.39 // indirect
	github.com/pion/sdp/v3 v3.0.13 // indirect
	github.com/pion/srtp/v3 v3.0.6 // indirect
	github.com/pion/stun v0.6.1 // indirect
	github.com/pion/stun/v3 v3.0.0 // indirect
	github.com/pion/transport/v2 v2.2.10 // indirect
	github.com/pion/transport/v3 v3.0.7 // indirect
	github.com/pion/turn/v4 v4.0.2 // indirect
	github.com/pion/webrtc/v4 v4.1.2 // indirect
	github.com/rivo/uniseg v0.2.0 // indirect
	github.com/wlynxg/anet v0.0.5 // indirect
	go.opentelemetry.io/auto/sdk v1.2.1 // indirect
	go.yaml.in/yaml/v2 v2.4.3 // indirect
	golang.org/x/telemetry v0.0.0-20250908211612-aef8a434d053 // indirect
	golang.org/x/time v0.12.0 // indirect
	google.golang.org/genproto v0.0.0-20240213162025-012b6fc9bca9 // indirect
	google.golang.org/grpc/cmd/protoc-gen-go-grpc v1.5.1 // indirect
)

require (
	github.com/alecthomas/units v0.0.0-20240927000941-0f3dac36c52b // indirect
	github.com/crackcomm/go-gitignore v0.0.0-20241020182519-7843d2ba8fdf // indirect
	github.com/hashicorp/golang-lru/v2 v2.0.7 // indirect
	github.com/ipfs/go-bitfield v1.1.0 // indirect
	github.com/quic-go/qpack v0.5.1 // indirect
	github.com/quic-go/quic-go v0.55.0
	github.com/quic-go/webtransport-go v0.9.0
	github.com/whyrusleeping/chunker v0.0.0-20181014151217-fe64bd25879f // indirect
)

require (
	github.com/aead/siphash v1.0.1 // indirect
	github.com/benbjohnson/clock v1.3.5 // indirect
	github.com/beorn7/perks v1.0.1 // indirect
	github.com/bernerdschaefer/eventsource v0.0.0-20130606115634-220e99a79763 // indirect
	github.com/btcsuite/btcd/btcec/v2 v2.2.1 // indirect
	github.com/btcsuite/btcd/btcutil/psbt v1.1.5 // indirect
	github.com/btcsuite/btcd/chaincfg/chainhash v1.0.1 // indirect
	github.com/btcsuite/btclog v0.0.0-20170628155309-84c8d2346e9f // indirect
	github.com/btcsuite/btcwallet v0.15.1 // indirect
	github.com/btcsuite/btcwallet/wallet/txauthor v1.2.3 // indirect
	github.com/btcsuite/btcwallet/wallet/txrules v1.2.0 // indirect
	github.com/btcsuite/btcwallet/wallet/txsizes v1.1.0 // indirect
	github.com/btcsuite/btcwallet/walletdb v1.4.0 // indirect
	github.com/btcsuite/btcwallet/wtxmgr v1.5.0 // indirect
	github.com/btcsuite/go-socks v0.0.0-20170105172521-4720035b7bfd // indirect
	github.com/btcsuite/websocket v0.0.0-20150119174127-31079b680792 // indirect
	github.com/bwmarrin/discordgo v0.28.1
	github.com/cenkalti/backoff/v4 v4.3.0 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/cskr/pubsub v1.0.2 // indirect
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/davidlazar/go-crypto v0.0.0-20200604182044-b73af7476f6c // indirect
	github.com/decred/dcrd/crypto/blake256 v1.1.0 // indirect
	github.com/decred/dcrd/dcrec/secp256k1/v4 v4.4.0 // indirect
	github.com/decred/dcrd/lru v1.1.1 // indirect
	github.com/desertbit/timer v0.0.0-20180107155436-c41aec40b27f // indirect
	github.com/flynn/noise v1.1.0 // indirect
	github.com/francoispqt/gojay v1.2.13 // indirect
	github.com/go-errors/errors v1.4.2 // indirect
	github.com/go-logr/logr v1.4.3 // indirect
	github.com/go-logr/stdr v1.2.2 // indirect
	github.com/go-ole/go-ole v1.2.6 // indirect
	github.com/godbus/dbus/v5 v5.1.0 // indirect
	github.com/golang/protobuf v1.5.4 // indirect
	github.com/google/gopacket v1.1.19 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/gorilla/websocket v1.5.3 // indirect
	github.com/hashicorp/golang-lru v1.0.2 // indirect
	github.com/huin/goupnp v1.3.0 // indirect
	github.com/iancoleman/orderedmap v0.3.0
	github.com/ipfs/bbloom v0.0.4 // indirect
	github.com/ipfs/go-cidutil v0.1.0 // indirect
	github.com/ipfs/go-ipfs-pq v0.0.3 // indirect
	github.com/ipfs/go-ipld-legacy v0.2.2 // indirect
	github.com/ipfs/go-metrics-interface v0.3.0 // indirect
	github.com/ipfs/go-peertaskqueue v0.8.2 // indirect
	github.com/jackpal/go-nat-pmp v1.0.2 // indirect
	github.com/jbenet/go-temp-err-catcher v0.1.0 // indirect
	github.com/kkdai/bstream v1.0.0 // indirect
	github.com/klauspost/cpuid/v2 v2.3.0 // indirect
	github.com/koron/go-ssdp v0.0.6 // indirect
	github.com/lib/pq v1.10.7 // indirect
	github.com/libp2p/go-buffer-pool v0.1.0 // indirect
	github.com/libp2p/go-cidranger v1.1.0 // indirect
	github.com/libp2p/go-flow-metrics v0.3.0 // indirect
	github.com/libp2p/go-libp2p-asn-util v0.4.1 // indirect
	github.com/libp2p/go-libp2p-kbucket v0.8.0 // indirect
	github.com/libp2p/go-libp2p-routing-helpers v0.7.5 // indirect
	github.com/libp2p/go-msgio v0.3.0
	github.com/libp2p/go-netroute v0.3.0 // indirect
	github.com/libp2p/go-reuseport v0.4.0 // indirect
	github.com/lightninglabs/gozmq v0.0.0-20191113021534-d20a764486bf // indirect
	github.com/lightninglabs/neutrino v0.14.2 // indirect
	github.com/lightningnetwork/lnd/clock v1.1.0 // indirect
	github.com/lightningnetwork/lnd/queue v1.1.0 // indirect
	github.com/lightningnetwork/lnd/ticker v1.1.0 // indirect
	github.com/lightningnetwork/lnd/tlv v1.0.3 // indirect
	github.com/lightningnetwork/lnd/tor v1.1.0 // indirect
	github.com/lufia/plan9stats v0.0.0-20211012122336-39d0f177ccd0 // indirect
	github.com/marten-seemann/tcp v0.0.0-20210406111302-dfbc87cc63fd // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/miekg/dns v1.1.68 // indirect
	github.com/mikioh/tcpinfo v0.0.0-20190314235526-30a79bb1804b // indirect
	github.com/mikioh/tcpopt v0.0.0-20190314235656-172688c1accc // indirect
	github.com/minio/sha256-simd v1.0.1 // indirect
	github.com/mr-tron/base58 v1.2.0 // indirect
	github.com/multiformats/go-base32 v0.1.0 // indirect
	github.com/multiformats/go-base36 v0.2.0 // indirect
	github.com/multiformats/go-multiaddr-dns v0.4.1 // indirect
	github.com/multiformats/go-multiaddr-fmt v0.1.0 // indirect
	github.com/multiformats/go-multistream v0.6.1 // indirect
	github.com/multiformats/go-varint v0.1.0 // indirect
	github.com/oklog/ulid/v2 v2.1.0 // indirect
	github.com/pbnjay/memory v0.0.0-20210728143218-7b4eea64cf58 // indirect
	github.com/pmezard/go-difflib v1.0.0 // indirect
	github.com/power-devops/perfstat v0.0.0-20210106213030-5aafc221ea8c // indirect
	github.com/prometheus/client_model v0.6.2 // indirect
	github.com/prometheus/common v0.66.1 // indirect
	github.com/prometheus/procfs v0.17.0 // indirect
	github.com/rs/cors v1.7.0 // indirect
	github.com/sahilm/fuzzy v0.1.1
	github.com/shoenig/go-m1cpu v0.1.6 // indirect
	github.com/spaolacci/murmur3 v1.1.0 // indirect
	github.com/tklauser/go-sysconf v0.3.12 // indirect
	github.com/tklauser/numcpus v0.6.1 // indirect
	github.com/whyrusleeping/cbor-gen v0.3.1 // indirect
	github.com/whyrusleeping/go-keyspace v0.0.0-20160322163242-5b898ac5add1 // indirect
	github.com/x448/float16 v0.8.4 // indirect
	github.com/yusufpapurcu/wmi v1.2.3 // indirect
	go.etcd.io/etcd/api/v3 v3.5.5 // indirect
	go.etcd.io/etcd/client/pkg/v3 v3.5.5 // indirect
	go.etcd.io/etcd/client/v3 v3.5.5 // indirect
	go.etcd.io/etcd/server/v3 v3.5.5 // indirect
	go.opencensus.io v0.24.0 // indirect
	go.opentelemetry.io/otel/metric v1.38.0 // indirect
	go.opentelemetry.io/otel/trace v1.38.0 // indirect
	go.uber.org/dig v1.19.0 // indirect
	go.uber.org/fx v1.24.0 // indirect
	go.uber.org/mock v0.5.2 // indirect
	golang.org/x/crypto v0.42.0 // indirect
	golang.org/x/mod v0.28.0 // indirect
	golang.org/x/net v0.44.0
	golang.org/x/sys v0.36.0 // indirect
	golang.org/x/term v0.35.0
	golang.org/x/tools v0.37.0 // indirect
	golang.org/x/xerrors v0.0.0-20240903120638-7835f813f4da // indirect
	gonum.org/v1/gonum v0.16.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20250825161204-c5933d9347a5 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
	lukechampine.com/blake3 v1.4.1 // indirect
	nhooyr.io/websocket v1.8.7 // indirect
)

replace roci.dev/fracdex => github.com/rocicorp/fracdex v0.0.0-20231009204907-ebc26eac9486

// LND imports etcd, which imports some very old version of OpenTelemetry,
// and it break the build in many different but miserable ways.
exclude go.etcd.io/etcd/server/v3 v3.5.0

tool (
	google.golang.org/grpc/cmd/protoc-gen-go-grpc
	google.golang.org/protobuf/cmd/protoc-gen-go
)
