package hmnet

import (
	"context"
	"seed/backend/blob"
	"seed/backend/config"
	"seed/backend/core"
	"seed/backend/core/coretest"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/logging"
	"seed/backend/storage"
	"seed/backend/util/future"
	"seed/backend/util/must"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

var _ p2p.P2PServer = (*rpcMux)(nil)

func TestAddrs(t *testing.T) {
	addrs := []string{
		"/ip4/192.168.0.104/tcp/55000/p2p/12D3KooWJfvidBgFaHGJn6v1pTzQz2xXtDvdh6iMcKU8CfLeW9iJ",
		"/ip4/127.0.0.1/tcp/55000/p2p/12D3KooWJfvidBgFaHGJn6v1pTzQz2xXtDvdh6iMcKU8CfLeW9iJ",
		"/ip4/23.20.24.146/tcp/4002/p2p/12D3KooWNmjM4sMbSkDEA6ShvjTgkrJHjMya46fhZ9PjKZ4KVZYq/p2p-circuit/p2p/12D3KooWJfvidBgFaHGJn6v1pTzQz2xXtDvdh6iMcKU8CfLeW9iJ",
		"/ip4/23.20.24.146/udp/4002/quic-v1/p2p/12D3KooWNmjM4sMbSkDEA6ShvjTgkrJHjMya46fhZ9PjKZ4KVZYq/p2p-circuit/p2p/12D3KooWJfvidBgFaHGJn6v1pTzQz2xXtDvdh6iMcKU8CfLeW9iJ",
	}

	info, err := AddrInfoFromStrings(addrs...)
	require.NoError(t, err)

	want := "{12D3KooWJfvidBgFaHGJn6v1pTzQz2xXtDvdh6iMcKU8CfLeW9iJ: [/ip4/192.168.0.104/tcp/55000 /ip4/127.0.0.1/tcp/55000 /ip4/23.20.24.146/tcp/4002/p2p/12D3KooWNmjM4sMbSkDEA6ShvjTgkrJHjMya46fhZ9PjKZ4KVZYq/p2p-circuit /ip4/23.20.24.146/udp/4002/quic-v1/p2p/12D3KooWNmjM4sMbSkDEA6ShvjTgkrJHjMya46fhZ9PjKZ4KVZYq/p2p-circuit]}"
	require.Equal(t, want, info.String())

	require.Equal(t, addrs, AddrInfoToStrings(info))
}

func makeTestPeer(t *testing.T, name string) (*Node, context.CancelFunc) {
	u := coretest.NewTester(name)

	db := storage.MakeTestDB(t)

	idx, err := blob.OpenIndex(context.Background(), db, logging.New("seed/hyper", "debug"), nil)
	require.NoError(t, err)

	cfg := config.Default().P2P
	cfg.Port = 0
	cfg.NoRelay = true
	cfg.BootstrapPeers = nil
	cfg.NoMetrics = true

	ks := core.NewMemoryKeyStore()
	require.NoError(t, ks.StoreKey(context.Background(), "main", u.Account))

	n, err := New(cfg, u.Device, ks, db, idx, must.Do2(zap.NewDevelopment()).Named(name))
	require.NoError(t, err)

	errc := make(chan error, 1)
	ctx, cancel := context.WithCancel(context.Background())
	f := future.New[*Node]()

	require.NoError(t, f.Resolve(n))

	go func() {
		errc <- n.Start(ctx)
	}()

	t.Cleanup(func() {
		require.NoError(t, <-errc)
	})

	select {
	case <-n.Ready():
	case err := <-errc:
		require.NoError(t, err)
	}

	return n, cancel
}
