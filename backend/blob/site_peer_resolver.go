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
// This is used to resolve siteURL to peer.AddrInfo and account ID.
type SiteConfigResponse struct {
	PeerID               string                `json:"peerId"`
	Addrs                []multiaddr.Multiaddr `json:"addrs"`
	RegisteredAccountUID string                `json:"registeredAccountUid,omitempty"`
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

// sitePeerEntry holds cached site config info with its expiration time.
type sitePeerEntry struct {
	config    SiteConfigResponse
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

// getConfig resolves a siteURL to its full config, using the cache when possible.
// It calls GET {siteURL}/hm/api/config and parses the response.
func (c *sitePeerResolver) getConfig(ctx context.Context, siteURL string) (SiteConfigResponse, error) {
	// Check cache first.
	entry, ok := c.cache.Get(siteURL)
	if ok && time.Now().Before(entry.expiresAt) {
		return entry.config, nil
	}

	// Cache miss or expired, fetch from siteURL.
	config, err := c.fetchConfig(ctx, siteURL)
	if err != nil {
		return SiteConfigResponse{}, err
	}

	// Store in cache.
	c.cache.Add(siteURL, sitePeerEntry{
		config:    config,
		expiresAt: time.Now().Add(c.ttl),
	})

	return config, nil
}

// getAddrInfo resolves a siteURL to peer.AddrInfo, using the cache when possible.
// It calls GET {siteURL}/hm/api/config and parses the response.
func (c *sitePeerResolver) getAddrInfo(ctx context.Context, siteURL string) (peer.AddrInfo, error) {
	config, err := c.getConfig(ctx, siteURL)
	if err != nil {
		return peer.AddrInfo{}, err
	}
	return config.AddrInfo()
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

// fetchConfig calls the /hm/api/config endpoint and returns the config.
// It retries transient errors (network errors, 5xx) up to 3 times with 300ms delay.
func (c *sitePeerResolver) fetchConfig(ctx context.Context, siteURL string) (SiteConfigResponse, error) {
	const maxRetries = 3
	const retryDelay = 300 * time.Millisecond

	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			select {
			case <-time.After(retryDelay):
			case <-ctx.Done():
				return SiteConfigResponse{}, ctx.Err()
			}
		}

		config, err := c.doFetchConfig(ctx, siteURL)
		if err == nil {
			return config, nil
		}

		lastErr = err

		// Only retry transient errors.
		var te transientError
		if !errors.As(err, &te) {
			return SiteConfigResponse{}, err
		}
	}
	return SiteConfigResponse{}, fmt.Errorf("failed after %d retries: %w", maxRetries, lastErr)
}

// doFetchConfig performs a single fetch attempt.
// It wraps transient errors (network errors, 5xx) so they can be retried.
func (c *sitePeerResolver) doFetchConfig(ctx context.Context, siteURL string) (SiteConfigResponse, error) {
	configURL := siteURL + "/hm/api/config"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, configURL, nil)
	if err != nil {
		return SiteConfigResponse{}, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		// Network errors are transient.
		return SiteConfigResponse{}, transientError{fmt.Errorf("failed to fetch config: %w", err)}
	}
	defer resp.Body.Close()

	// 5xx errors are transient (server issues).
	if resp.StatusCode >= 500 && resp.StatusCode < 600 {
		return SiteConfigResponse{}, transientError{fmt.Errorf("config endpoint returned status %d", resp.StatusCode)}
	}

	// Other non-200 errors are not transient (4xx are client errors).
	if resp.StatusCode != http.StatusOK {
		return SiteConfigResponse{}, fmt.Errorf("config endpoint returned status %d", resp.StatusCode)
	}

	var result SiteConfigResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return SiteConfigResponse{}, fmt.Errorf("failed to decode response: %w", err)
	}

	return result, nil
}
