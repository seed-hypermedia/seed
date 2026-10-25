package daemon

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"seed/backend/config"
	"strings"
)

// apiAccess admits callers at the network boundary, before HTTP routing or RPC
// dispatch. Server deployments instead rely on their private network boundary.
type apiAccess struct {
	server  bool
	peers   []netip.Prefix
	hosts   map[string]bool
	origins map[string]bool
}

func newAPIAccess(cfg config.Base) (*apiAccess, error) {
	a := &apiAccess{server: cfg.ServerMode, hosts: map[string]bool{}, origins: map[string]bool{}}
	if a.server {
		return a, nil
	}

	for _, raw := range strings.Split(cfg.APIAllowedPeers, ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}

		prefix, err := netip.ParsePrefix(raw)
		if err != nil {
			addr, err := netip.ParseAddr(raw)
			if err != nil || addr.Zone() != "" {
				return nil, fmt.Errorf("invalid api.allowed-peers entry %q", raw)
			}

			addr = addr.Unmap()
			prefix = netip.PrefixFrom(addr, addr.BitLen())
		}

		if prefix.Addr().Is4In6() {
			if prefix.Bits() < 96 {
				return nil, fmt.Errorf("invalid mapped IPv4 api.allowed-peers prefix %q", raw)
			}

			prefix = netip.PrefixFrom(prefix.Addr().Unmap(), prefix.Bits()-96)
		}

		a.peers = append(a.peers, prefix.Masked())
	}

	for _, raw := range strings.Split(cfg.APIAllowedHosts, ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}

		u, err := url.Parse("//" + raw)
		if err != nil || u.Host != raw || u.User != nil || u.Hostname() != raw || strings.ContainsAny(raw, ":/?#\\*") {
			return nil, fmt.Errorf("invalid api.allowed-hosts hostname %q", raw)
		}

		a.hosts[strings.ToLower(raw)] = true
	}

	for _, raw := range strings.Split(cfg.APIAllowedOrigins, ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}

		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.Scheme+"://"+u.Host != raw {
			return nil, fmt.Errorf("invalid api.allowed-origins origin %q", raw)
		}

		a.origins[raw] = true
	}

	return a, nil
}

func (a *apiAccess) allowsIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if ip.IsLoopback() {
		return true
	}

	for _, prefix := range a.peers {
		if prefix.Contains(ip) {
			return true
		}
	}

	return false
}

func (a *apiAccess) middleware(next http.Handler) http.Handler {
	if a.server {
		return next
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		peer, err := netip.ParseAddrPort(r.RemoteAddr)
		if err != nil {
			http.Error(w, "bad remote address", http.StatusBadRequest)
			return
		}

		if !a.allowsIP(peer.Addr()) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}

		// Peer and browser metadata cannot detect DNS rebinding. Validate the
		// authority without resolving it, even for same-origin browser requests.
		authority, err := url.Parse("//" + r.Host)
		if err != nil || authority.Host != r.Host || authority.User != nil {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}

		host := authority.Hostname()

		addr, _ := netip.ParseAddr(host)
		if !strings.EqualFold(host, "localhost") && !a.hosts[strings.ToLower(host)] && !a.allowsIP(addr) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}

		origin := r.Header.Get("Origin")
		if ref := r.Header.Get("Referer"); origin == "" && ref != "" {
			// Media and frames can omit Origin. Their browser-controlled Referer
			// still identifies the initiating origin; never use a prefix match.
			u, err := url.Parse(ref)
			if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}

			origin = u.Scheme + "://" + u.Host
		}

		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}

		trustedOrigin := origin != "" && (origin == scheme+"://"+r.Host || a.origins[origin])
		if origin != "" && !trustedOrigin {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}

		switch r.Header.Get("Sec-Fetch-Site") {
		case "", "none", "same-origin":
			// Headerless tools and direct navigation still need an admitted peer
			// and Host. An Origin, when present, must independently be trusted.
		case "same-site", "cross-site":
			if !trustedOrigin {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
		default:
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// apiListener filters the original TCP peer before gRPC accepts the connection,
// covering unary RPCs and streams without changing grpcui's in-process transport.
type apiListener struct {
	net.Listener
	access *apiAccess
}

func (l *apiListener) Accept() (net.Conn, error) {
	for {
		conn, err := l.Listener.Accept()
		if err != nil {
			return nil, err
		}

		peer, err := netip.ParseAddrPort(conn.RemoteAddr().String())
		if err == nil && l.access.allowsIP(peer.Addr()) {
			return conn, nil
		}

		_ = conn.Close()
	}
}
