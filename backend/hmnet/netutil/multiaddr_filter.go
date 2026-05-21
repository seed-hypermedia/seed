package netutil

import (
	"net"
	"strings"
)

// FilterRoutableMultiaddrs drops multiaddrs whose IP component is in a
// non-routable range (RFC 1918 private, loopback, link-local, unspecified,
// or IPv6 ULA/link-local). libp2p's identify protocol announces every bound
// network interface by default — including LAN-local addresses that no peer
// outside the originating subnet can ever reach. Storing or gossiping those
// addresses just bloats the peers.addresses column and downstream peer
// exchanges without ever yielding a successful dial.
//
// /p2p-circuit/ multiaddrs are kept unconditionally: an embedded LAN address
// is the relay hop's local network, not ours, so the routing remains valid
// through the public relay.
//
// /dns*, public IPv4, and public IPv6 multiaddrs are kept.
//
// The returned slice may alias the input; callers that mutate further
// should copy first.
func FilterRoutableMultiaddrs(addrs []string) []string {
	out := addrs[:0]
	for _, a := range addrs {
		a = strings.TrimSpace(a)
		if a == "" {
			continue
		}
		if isNonRoutableMultiaddr(a) {
			continue
		}
		out = append(out, a)
	}
	return out
}

// isNonRoutableMultiaddr reports whether the leading IP component of a
// multiaddr (if any) is in a range we can never route to from outside the
// originating LAN. Anything not starting with /ip4/ or /ip6/ (e.g. /dns*,
// /p2p-circuit/, etc.) is treated as routable: those forms either use DNS
// resolution we can do, or carry their own relay-based routing semantics.
//
// /p2p-circuit/ short-circuits to "keep" — relays are reachable via the
// outer relay hop regardless of the inner peer's announced LAN addresses.
func isNonRoutableMultiaddr(addr string) bool {
	if strings.Contains(addr, "/p2p-circuit") {
		return false
	}

	const (
		ip4 = "/ip4/"
		ip6 = "/ip6/"
	)
	switch {
	case strings.HasPrefix(addr, ip4):
		return isNonRoutableV4(extractIPPart(addr[len(ip4):]))
	case strings.HasPrefix(addr, ip6):
		return isNonRoutableV6(extractIPPart(addr[len(ip6):]))
	}
	return false
}

// extractIPPart returns the IP literal that appears between the leading
// "/ipN/" prefix and the next "/" segment separator.
func extractIPPart(rest string) string {
	ip, _, _ := strings.Cut(rest, "/")
	return ip
}

func isNonRoutableV4(s string) bool {
	ip := net.ParseIP(s)
	if ip == nil {
		// Malformed multiaddr — let the parser further down reject it
		// rather than silently dropping the address here.
		return false
	}
	ip4 := ip.To4()
	if ip4 == nil {
		return false
	}
	switch {
	case ip4[0] == 10:
		return true
	case ip4[0] == 127:
		return true
	case ip4[0] == 192 && ip4[1] == 168:
		return true
	case ip4[0] == 172 && ip4[1] >= 16 && ip4[1] <= 31:
		return true
	case ip4[0] == 169 && ip4[1] == 254: // link-local
		return true
	case ip4[0] == 0: // unspecified / "this network"
		return true
	}
	return false
}

func isNonRoutableV6(s string) bool {
	ip := net.ParseIP(s)
	if ip == nil {
		return false
	}
	if ip.To4() != nil {
		// IPv4-mapped IPv6 — apply the IPv4 rules.
		return isNonRoutableV4(ip.To4().String())
	}
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
		return true
	}
	// ULA: fc00::/7
	if len(ip) == 16 && ip[0]&0xfe == 0xfc {
		return true
	}
	return false
}
