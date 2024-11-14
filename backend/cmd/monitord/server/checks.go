// Package server is the serve to monitor site status.
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	peer "github.com/libp2p/go-libp2p/core/peer"
	peerstore "github.com/libp2p/go-libp2p/core/peerstore"
	ping "github.com/libp2p/go-libp2p/p2p/protocol/ping"
	"github.com/multiformats/go-multiaddr"
)

func (s *Srv) checkP2P(ctx context.Context, peer peer.AddrInfo, numPings int) (time.Duration, error) {
	ttl := peerstore.TempAddrTTL
	deadline, hasDeadline := ctx.Deadline()
	if hasDeadline {
		ttl = time.Until(deadline)
	}
	s.node.Peerstore().AddAddrs(peer.ID, peer.Addrs, ttl)

	pings := ping.Ping(ctx, s.node, peer.ID)

	var (
		count int
		total time.Duration
	)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for i := 0; i < numPings; i++ {
		res, ok := <-pings
		if !ok {
			break
		}
		if res.Error != nil {
			return total, fmt.Errorf("Could not ping: %w", res.Error)
		}
		count++
		total += res.RTT

		select {
		case <-ticker.C:
		case <-ctx.Done():
			return total, ctx.Err()
		}
	}

	if count == 0 {
		return total, fmt.Errorf("Ping Failed")
	}
	pingAvg := time.Duration((total.Nanoseconds()) / int64(count))
	return pingAvg, nil
}

func (s *Srv) checkSeedAddrs(ctx context.Context, hostname, mustInclude string) (info peer.AddrInfo, err error) {
	resp, err := getSiteInfoHTTP(ctx, nil, hostname)
	if err != nil {
		return info, err
	}

	pid, err := peer.Decode(resp.PeerID)
	if err != nil {
		return info, fmt.Errorf("failed to decode peer ID %s: %w", resp.PeerID, err)
	}

	info.ID = pid
	info.Addrs = make([]multiaddr.Multiaddr, len(resp.Addrs))
	for i, as := range resp.Addrs {
		info.Addrs[i], err = multiaddr.NewMultiaddr(as)
		if err != nil {
			return info, err
		}
	}

	return info, nil
}

type publicSiteInfo struct {
	RegisteredAccountUID string   `json:"registeredAccountUid,omitempty"`
	PeerID               string   `json:"peerId"`
	Addrs                []string `json:"addrs"`
}

func getSiteInfoHTTP(ctx context.Context, client *http.Client, siteURL string) (*publicSiteInfo, error) {
	if client == nil {
		client = http.DefaultClient
	}

	if siteURL[len(siteURL)-1] == '/' {
		return nil, fmt.Errorf("site URL must not have trailing slash: %s", siteURL)
	}

	requestURL := siteURL + "/hm/api/config"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, fmt.Errorf("could not create request to hm/api/config site: %w ", err)
	}

	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("could not contact to provided site [%s]: %w ", requestURL, err)
	}
	defer res.Body.Close()

	data, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, fmt.Errorf("site info url %q not working, status code: %d, response body: %s", requestURL, res.StatusCode, data)
	}

	resp := &publicSiteInfo{}
	if err := json.Unmarshal(data, resp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal JSON body: %w", err)
	}

	return resp, nil
}
