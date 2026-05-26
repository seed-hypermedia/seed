package netutil

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestFilterRoutableMultiaddrs(t *testing.T) {
	tests := []struct {
		name string
		in   []string
		keep []string
	}{
		{
			name: "drops RFC 1918 10/8",
			in:   []string{"/ip4/10.1.0.7/tcp/4002/p2p/12D3KooWtest"},
			keep: nil,
		},
		{
			name: "drops 192.168/16",
			in:   []string{"/ip4/192.168.1.42/udp/4002/quic-v1/p2p/12D3KooWtest"},
			keep: nil,
		},
		{
			name: "drops 172.16-31/12",
			in:   []string{"/ip4/172.16.0.1/tcp/4002", "/ip4/172.31.255.254/tcp/4002"},
			keep: nil,
		},
		{
			name: "keeps 172.15 and 172.32 (outside RFC 1918)",
			in:   []string{"/ip4/172.15.0.1/tcp/4002", "/ip4/172.32.0.1/tcp/4002"},
			keep: []string{"/ip4/172.15.0.1/tcp/4002", "/ip4/172.32.0.1/tcp/4002"},
		},
		{
			name: "drops loopback",
			in:   []string{"/ip4/127.0.0.1/tcp/4002", "/ip4/127.255.255.255/tcp/4002"},
			keep: nil,
		},
		{
			name: "drops link-local 169.254/16",
			in:   []string{"/ip4/169.254.5.5/tcp/4002"},
			keep: nil,
		},
		{
			name: "drops 0.0.0.0 unspecified",
			in:   []string{"/ip4/0.0.0.0/tcp/4002"},
			keep: nil,
		},
		{
			name: "keeps public IPv4",
			in:   []string{"/ip4/15.204.217.165/tcp/4002/p2p/12D3KooWtest"},
			keep: []string{"/ip4/15.204.217.165/tcp/4002/p2p/12D3KooWtest"},
		},
		{
			name: "keeps /dns",
			in:   []string{"/dns4/gabo.es/tcp/56000/p2p/12D3KooWtest", "/dns6/hyper.media/udp/56001"},
			keep: []string{"/dns4/gabo.es/tcp/56000/p2p/12D3KooWtest", "/dns6/hyper.media/udp/56001"},
		},
		{
			name: "keeps p2p-circuit even when inner has private IP",
			in: []string{
				"/ip4/192.168.0.10/tcp/4002/p2p/12D3KooWRELAY/p2p-circuit/p2p/12D3KooWtest",
			},
			keep: []string{
				"/ip4/192.168.0.10/tcp/4002/p2p/12D3KooWRELAY/p2p-circuit/p2p/12D3KooWtest",
			},
		},
		{
			name: "drops IPv6 loopback ::1",
			in:   []string{"/ip6/::1/tcp/4002"},
			keep: nil,
		},
		{
			name: "drops IPv6 link-local fe80::/10",
			in:   []string{"/ip6/fe80::1/tcp/4002", "/ip6/febf::1/tcp/4002"},
			keep: nil,
		},
		{
			name: "drops IPv6 ULA fc00::/7",
			in:   []string{"/ip6/fc00::1/tcp/4002", "/ip6/fd12:3456::1/tcp/4002"},
			keep: nil,
		},
		{
			name: "keeps public IPv6 2000::/3",
			in:   []string{"/ip6/2001:db8::1/tcp/4002", "/ip6/2606:4700::1/udp/4002/quic-v1"},
			keep: []string{"/ip6/2001:db8::1/tcp/4002", "/ip6/2606:4700::1/udp/4002/quic-v1"},
		},
		{
			name: "mixed input — keeps public, drops private",
			in: []string{
				"/ip4/10.1.0.7/tcp/4002/p2p/12D3KooWtest",
				"/ip4/15.204.217.165/tcp/4002/p2p/12D3KooWtest",
				"/dns4/hyper.media/udp/56001",
				"/ip6/fe80::1/tcp/4002",
				"/ip6/2001:db8::1/tcp/4002",
				"/ip4/192.168.5.82/udp/4002/quic-v1",
			},
			keep: []string{
				"/ip4/15.204.217.165/tcp/4002/p2p/12D3KooWtest",
				"/dns4/hyper.media/udp/56001",
				"/ip6/2001:db8::1/tcp/4002",
			},
		},
		{
			name: "empty input",
			in:   nil,
			keep: nil,
		},
		{
			name: "whitespace-only entries dropped",
			in:   []string{"", "   ", "/ip4/15.204.217.165/tcp/4002"},
			keep: []string{"/ip4/15.204.217.165/tcp/4002"},
		},
		{
			name: "malformed entry is kept (caller's parser rejects later)",
			in:   []string{"not-a-multiaddr"},
			keep: []string{"not-a-multiaddr"},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// Defensive copy because FilterRoutableMultiaddrs may alias the input.
			in := append([]string(nil), tc.in...)
			got := FilterRoutableMultiaddrs(in)
			if len(tc.keep) == 0 {
				require.Empty(t, got)
				return
			}
			require.Equal(t, tc.keep, got)
		})
	}
}

func TestFilterCertHashMultiaddrs(t *testing.T) {
	tests := []struct {
		name string
		in   []string
		keep []string
	}{
		{
			name: "drops webrtc-direct with certhash",
			in: []string{
				"/ip4/40.160.6.196/udp/4002/webrtc-direct/certhash/uEiA-GugbhlMianZMR4Y3IoyhJCCgU1rwpgsBUIiq2NwX-g/p2p/12D3KooWtest",
			},
			keep: nil,
		},
		{
			name: "drops webtransport with certhash",
			in: []string{
				"/ip4/15.204.217.165/udp/4002/quic-v1/webtransport/certhash/uEiAtest/p2p/12D3KooWtest",
			},
			keep: nil,
		},
		{
			name: "drops relayed webrtc-direct with relay certhash",
			in: []string{
				"/ip4/40.160.6.196/udp/4002/webrtc-direct/certhash/uEiA-Gugbhl/p2p/12D3KooWRELAY/p2p-circuit/p2p/12D3KooWTARGET",
			},
			keep: nil,
		},
		{
			name: "keeps tcp",
			in:   []string{"/ip4/15.204.217.165/tcp/4002/p2p/12D3KooWtest"},
			keep: []string{"/ip4/15.204.217.165/tcp/4002/p2p/12D3KooWtest"},
		},
		{
			name: "keeps quic-v1",
			in:   []string{"/ip4/15.204.217.165/udp/4002/quic-v1/p2p/12D3KooWtest"},
			keep: []string{"/ip4/15.204.217.165/udp/4002/quic-v1/p2p/12D3KooWtest"},
		},
		{
			name: "keeps webrtc-direct without certhash (libp2p will reject at dial time if it needs one)",
			in:   []string{"/ip4/15.204.217.165/udp/4002/webrtc-direct/p2p/12D3KooWtest"},
			keep: []string{"/ip4/15.204.217.165/udp/4002/webrtc-direct/p2p/12D3KooWtest"},
		},
		{
			name: "keeps dns",
			in:   []string{"/dns4/gabo.es/tcp/56000/p2p/12D3KooWtest"},
			keep: []string{"/dns4/gabo.es/tcp/56000/p2p/12D3KooWtest"},
		},
		{
			name: "mixed input — drops only certhash entries, preserves order",
			in: []string{
				"/ip4/15.204.217.165/tcp/4002/p2p/12D3KooWtest",
				"/ip4/40.160.6.196/udp/4002/webrtc-direct/certhash/uEiA1/p2p/12D3KooWtest",
				"/ip4/15.204.217.165/udp/4002/quic-v1/p2p/12D3KooWtest",
				"/ip4/40.160.6.196/udp/4002/webrtc-direct/certhash/uEiA2/p2p/12D3KooWtest",
				"/dns4/hyper.media/tcp/56000/p2p/12D3KooWtest",
			},
			keep: []string{
				"/ip4/15.204.217.165/tcp/4002/p2p/12D3KooWtest",
				"/ip4/15.204.217.165/udp/4002/quic-v1/p2p/12D3KooWtest",
				"/dns4/hyper.media/tcp/56000/p2p/12D3KooWtest",
			},
		},
		{
			name: "collapses many certhash variants of the same endpoint to nothing",
			in: []string{
				"/ip4/40.160.6.196/udp/4002/webrtc-direct/certhash/uEiA1/p2p/12D3KooWtest",
				"/ip4/40.160.6.196/udp/4002/webrtc-direct/certhash/uEiA2/p2p/12D3KooWtest",
				"/ip4/40.160.6.196/udp/4002/webrtc-direct/certhash/uEiA3/p2p/12D3KooWtest",
			},
			keep: nil,
		},
		{
			name: "empty input",
			in:   nil,
			keep: nil,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			in := append([]string(nil), tc.in...)
			got := FilterCertHashMultiaddrs(in)
			if len(tc.keep) == 0 {
				require.Empty(t, got)
				return
			}
			require.Equal(t, tc.keep, got)
		})
	}

	t.Run("idempotent", func(t *testing.T) {
		in := []string{
			"/ip4/15.204.217.165/tcp/4002/p2p/12D3KooWtest",
			"/ip4/40.160.6.196/udp/4002/webrtc-direct/certhash/uEiA1/p2p/12D3KooWtest",
		}
		once := FilterCertHashMultiaddrs(append([]string(nil), in...))
		twice := FilterCertHashMultiaddrs(append([]string(nil), once...))
		require.Equal(t, once, twice)
	})

	t.Run("composes with FilterRoutableMultiaddrs", func(t *testing.T) {
		in := []string{
			"/ip4/10.0.0.1/tcp/4002/p2p/12D3KooWtest",
			"/ip4/15.204.217.165/tcp/4002/p2p/12D3KooWtest",
			"/ip4/15.204.217.165/udp/4002/webrtc-direct/certhash/uEiA1/p2p/12D3KooWtest",
		}
		got := FilterCertHashMultiaddrs(FilterRoutableMultiaddrs(append([]string(nil), in...)))
		require.Equal(t, []string{"/ip4/15.204.217.165/tcp/4002/p2p/12D3KooWtest"}, got)
	})
}
