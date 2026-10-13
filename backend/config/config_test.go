package config

import (
	"flag"
	"io"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBootstrapPeersFlag(t *testing.T) {
	const (
		peerA = "/ip4/40.160.6.196/tcp/4002/p2p/12D3KooWNmjM4sMbSkDEA6ShvjTgkrJHjMya46fhZ9PjKZ4KVZYq"
		peerB = "/dns4/gabo.es/tcp/56000/p2p/12D3KooWGvsbBfcbnkecNoRBM7eUTiuriDqUyzu87pobZXSdUUsJ"
	)

	parse := func(t *testing.T, value string) (P2P, error) {
		t.Helper()
		p2p := P2P{}.Default()
		require.False(t, p2p.NoBootstrap(), "default config must have bootstrap peers")

		fs := flag.NewFlagSet(t.Name(), flag.ContinueOnError)
		fs.SetOutput(io.Discard)
		p2p.BindFlags(fs)
		err := fs.Parse([]string{"-p2p.bootstrap-peers=" + value})
		return p2p, err
	}

	t.Run("none disables bootstrapping", func(t *testing.T) {
		p2p, err := parse(t, NoBootstrapPeers)
		require.NoError(t, err)
		require.Nil(t, p2p.BootstrapPeers)
		require.True(t, p2p.NoBootstrap())
	})

	t.Run("empty disables bootstrapping", func(t *testing.T) {
		p2p, err := parse(t, "")
		require.NoError(t, err)
		require.Nil(t, p2p.BootstrapPeers)
		require.True(t, p2p.NoBootstrap())
	})

	t.Run("valid list is parsed", func(t *testing.T) {
		p2p, err := parse(t, peerA+","+peerB)
		require.NoError(t, err)
		require.Len(t, p2p.BootstrapPeers, 2)
		require.False(t, p2p.NoBootstrap())

		// AddrInfosFromP2pAddrs groups addresses through a map, so the order is not stable.
		var ids []string

		for _, info := range p2p.BootstrapPeers {
			ids = append(ids, info.ID.String())
			require.Len(t, info.Addrs, 1)
			require.True(t, p2p.IsBootstrap(info.ID))
		}

		require.ElementsMatch(t, []string{
			"12D3KooWNmjM4sMbSkDEA6ShvjTgkrJHjMya46fhZ9PjKZ4KVZYq",
			"12D3KooWGvsbBfcbnkecNoRBM7eUTiuriDqUyzu87pobZXSdUUsJ",
		}, ids)
	})

	t.Run("invalid multiaddr is an error", func(t *testing.T) {
		_, err := parse(t, peerA+",not-a-multiaddr")
		require.Error(t, err)
	})

	t.Run("multiaddr without peer id is an error", func(t *testing.T) {
		_, err := parse(t, "/ip4/127.0.0.1/tcp/4002")
		require.Error(t, err)
	})
}

func TestIsolatedFlag(t *testing.T) {
	p2p := P2P{}.Default()
	require.False(t, p2p.Isolated)
	require.False(t, p2p.NoBootstrap())

	fs := flag.NewFlagSet(t.Name(), flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	p2p.BindFlags(fs)
	require.NoError(t, fs.Parse([]string{"-p2p.isolated"}))

	require.True(t, p2p.Isolated)
	require.NotEmpty(t, p2p.BootstrapPeers, "the default peer list is left alone")
	require.True(t, p2p.NoBootstrap(), "an isolated node never bootstraps")
}

func TestLndhubDisabledFlag(t *testing.T) {
	cfg := Lndhub{}.Default()
	require.False(t, cfg.Disabled)

	fs := flag.NewFlagSet(t.Name(), flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	cfg.BindFlags(fs)
	require.NoError(t, fs.Parse([]string{"-lndhub.disabled", "-lndhub.mainnet"}))

	require.True(t, cfg.Disabled)
	require.True(t, cfg.Mainnet)
}
