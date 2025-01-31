package hmnet

import (
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/hmnet/netutil"
	"testing"

	"github.com/stretchr/testify/require"
)

var _ p2p.P2PServer = (*rpcMux)(nil)

func TestAddrs(t *testing.T) {
	addrs := []string{
		"/ip4/192.168.0.104/tcp/55000/p2p/12D3KooWJfvidBgFaHGJn6v1pTzQz2xXtDvdh6iMcKU8CfLeW9iJ",
		"/ip4/127.0.0.1/tcp/55000/p2p/12D3KooWJfvidBgFaHGJn6v1pTzQz2xXtDvdh6iMcKU8CfLeW9iJ",
		"/ip4/23.20.24.146/tcp/4002/p2p/12D3KooWNmjM4sMbSkDEA6ShvjTgkrJHjMya46fhZ9PjKZ4KVZYq/p2p-circuit/p2p/12D3KooWJfvidBgFaHGJn6v1pTzQz2xXtDvdh6iMcKU8CfLeW9iJ",
		"/ip4/23.20.24.146/udp/4002/quic-v1/p2p/12D3KooWNmjM4sMbSkDEA6ShvjTgkrJHjMya46fhZ9PjKZ4KVZYq/p2p-circuit/p2p/12D3KooWJfvidBgFaHGJn6v1pTzQz2xXtDvdh6iMcKU8CfLeW9iJ",
	}

	info, err := netutil.AddrInfoFromStrings(addrs...)
	require.NoError(t, err)

	want := "{12D3KooWJfvidBgFaHGJn6v1pTzQz2xXtDvdh6iMcKU8CfLeW9iJ: [/ip4/192.168.0.104/tcp/55000 /ip4/127.0.0.1/tcp/55000 /ip4/23.20.24.146/tcp/4002/p2p/12D3KooWNmjM4sMbSkDEA6ShvjTgkrJHjMya46fhZ9PjKZ4KVZYq/p2p-circuit /ip4/23.20.24.146/udp/4002/quic-v1/p2p/12D3KooWNmjM4sMbSkDEA6ShvjTgkrJHjMya46fhZ9PjKZ4KVZYq/p2p-circuit]}"
	require.Equal(t, want, info.String())

	require.Equal(t, addrs, AddrInfoToStrings(info))
}
