package blob

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
)

// SiteConfigResponse is the response returned by the /hm/api/config endpoint.
// This is used to resolve siteURL to peer.AddrInfo.
type SiteConfigResponse struct {
	PeerID string                `json:"peerId"`
	Addrs  []multiaddr.Multiaddr `json:"addrs"`
}

// AddrInfo converts the [SiteConfigResponse] to a [peer.AddrInfo].
func (x SiteConfigResponse) AddrInfo() (peer.AddrInfo, error) {
	pid, err := peer.Decode(x.PeerID)
	if err != nil {
		return peer.AddrInfo{}, err
	}

	return peer.AddrInfo{
		ID:    pid,
		Addrs: x.Addrs,
	}, nil
}

// sitePeerEntry holds cached peer address info with its expiration time.
type sitePeerEntry struct {
	addrInfo  peer.AddrInfo
	expiresAt time.Time
}

// sitePeerResolver resolves siteUrl to peer.ID with TTL-based caching.
// The underlying LRU cache is thread-safe, so no external synchronization is needed.
type sitePeerResolver struct {
	cache  *lru.Cache[string, sitePeerEntry]
	ttl    time.Duration
	client *http.Client
}

// newSitePeerResolver creates a new cache for resolving site URLs to peer IDs.
// size is the maximum number of entries to cache.
// ttl is the time-to-live for cache entries.
func newSitePeerResolver(size int, ttl time.Duration) *sitePeerResolver {
	c, err := lru.New[string, sitePeerEntry](size)
	if err != nil {
		panic(err)
	}

	return &sitePeerResolver{
		cache:  c,
		ttl:    ttl,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

// getAddrInfo resolves a siteURL to peer.AddrInfo, using the cache when possible.
// It calls GET {siteURL}/hm/api/config and parses the response.
func (c *sitePeerResolver) getAddrInfo(ctx context.Context, siteURL string) (peer.AddrInfo, error) {
	// Check cache first.
	entry, ok := c.cache.Get(siteURL)
	if ok && time.Now().Before(entry.expiresAt) {
		return entry.addrInfo, nil
	}

	// Cache miss or expired, fetch from siteURL.
	addrInfo, err := c.fetchAddrInfo(ctx, siteURL)
	if err != nil {
		return peer.AddrInfo{}, err
	}

	// Store in cache.
	c.cache.Add(siteURL, sitePeerEntry{
		addrInfo:  addrInfo,
		expiresAt: time.Now().Add(c.ttl),
	})

	return addrInfo, nil
}

// getPeerID resolves a siteURL to a peer ID, using the cache when possible.
// It calls GET {siteURL}/hm/api/config and parses the peerId field.
// This is a convenience method that calls getAddrInfo and returns only the peer ID.
func (c *sitePeerResolver) getPeerID(ctx context.Context, siteURL string) (peer.ID, error) {
	addrInfo, err := c.getAddrInfo(ctx, siteURL)
	if err != nil {
		return "", err
	}
	return addrInfo.ID, nil
}

// transientError wraps errors that are worth retrying.
type transientError struct {
	err error
}

func (e transientError) Error() string {
	return e.err.Error()
}

func (e transientError) Unwrap() error {
	return e.err
}

// fetchAddrInfo calls the /hm/api/config endpoint and extracts the AddrInfo.
// It retries transient errors (network errors, 5xx) up to 3 times with 300ms delay.
func (c *sitePeerResolver) fetchAddrInfo(ctx context.Context, siteURL string) (peer.AddrInfo, error) {
	const maxRetries = 3
	const retryDelay = 300 * time.Millisecond

	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			select {
			case <-time.After(retryDelay):
			case <-ctx.Done():
				return peer.AddrInfo{}, ctx.Err()
			}
		}

		addrInfo, err := c.doFetchAddrInfo(ctx, siteURL)
		if err == nil {
			return addrInfo, nil
		}

		lastErr = err

		// Only retry transient errors.
		var te transientError
		if !errors.As(err, &te) {
			return peer.AddrInfo{}, err
		}
	}
	return peer.AddrInfo{}, fmt.Errorf("failed after %d retries: %w", maxRetries, lastErr)
}

// doFetchAddrInfo performs a single fetch attempt.
// It wraps transient errors (network errors, 5xx) so they can be retried.
func (c *sitePeerResolver) doFetchAddrInfo(ctx context.Context, siteURL string) (peer.AddrInfo, error) {
	configURL := siteURL + "/hm/api/config"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, configURL, nil)
	if err != nil {
		return peer.AddrInfo{}, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		// Network errors are transient.
		return peer.AddrInfo{}, transientError{fmt.Errorf("failed to fetch config: %w", err)}
	}
	defer resp.Body.Close()

	// 5xx errors are transient (server issues).
	if resp.StatusCode >= 500 && resp.StatusCode < 600 {
		return peer.AddrInfo{}, transientError{fmt.Errorf("config endpoint returned status %d", resp.StatusCode)}
	}

	// Other non-200 errors are not transient (4xx are client errors).
	if resp.StatusCode != http.StatusOK {
		return peer.AddrInfo{}, fmt.Errorf("config endpoint returned status %d", resp.StatusCode)
	}

	var result SiteConfigResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return peer.AddrInfo{}, fmt.Errorf("failed to decode response: %w", err)
	}

	if result.PeerID == "" {
		return peer.AddrInfo{}, fmt.Errorf("empty peer ID in response")
	}

	addrInfo, err := result.AddrInfo()
	if err != nil {
		return peer.AddrInfo{}, fmt.Errorf("invalid peer info in response: %w", err)
	}

	return addrInfo, nil
}
