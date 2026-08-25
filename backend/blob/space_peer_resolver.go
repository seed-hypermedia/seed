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

// SpaceConfigResponse is the response returned by the /hm/api/config endpoint.
// This is used to resolve spaceURL to peer.AddrInfo and account ID.
type SpaceConfigResponse struct {
	PeerID               string                `json:"peerId"`
	Addrs                []multiaddr.Multiaddr `json:"addrs"`
	RegisteredAccountUID string                `json:"registeredAccountUid,omitempty"`
	IsGateway            bool                  `json:"isGateway,omitempty"`
}

// AddrInfo converts the [SpaceConfigResponse] to a [peer.AddrInfo].
func (x SpaceConfigResponse) AddrInfo() (peer.AddrInfo, error) {
	pid, err := peer.Decode(x.PeerID)
	if err != nil {
		return peer.AddrInfo{}, err
	}

	return peer.AddrInfo{
		ID:    pid,
		Addrs: x.Addrs,
	}, nil
}

// spacePeerEntry holds cached space config info with its expiration time.
type spacePeerEntry struct {
	config    SpaceConfigResponse
	expiresAt time.Time
}

// spacePeerResolver resolves siteUrl to peer.ID with TTL-based caching.
// The underlying LRU cache is thread-safe, so no external synchronization is needed.
type spacePeerResolver struct {
	cache        *lru.Cache[string, spacePeerEntry]
	ttl          time.Duration
	client       *http.Client
	domainStore  *DomainStore // optional persistent fallback
}

// newSpacePeerResolver creates a new cache for resolving space URLs to peer IDs.
// size is the maximum number of entries to cache.
// ttl is the time-to-live for cache entries.
func newSpacePeerResolver(size int, ttl time.Duration) *spacePeerResolver {
	c, err := lru.New[string, spacePeerEntry](size)
	if err != nil {
		panic(err)
	}

	return &spacePeerResolver{
		cache:  c,
		ttl:    ttl,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

// getConfig resolves a spaceURL to its full config, using the cache when possible.
// It calls GET {spaceURL}/hm/api/config and parses the response.
// If the network fetch fails and a DomainStore is configured, it falls back to the persistent cache.
func (c *spacePeerResolver) getConfig(ctx context.Context, spaceURL string) (SpaceConfigResponse, error) {
	// Check in-memory cache first.
	entry, ok := c.cache.Get(spaceURL)
	if ok && time.Now().Before(entry.expiresAt) {
		return entry.config, nil
	}

	// Cache miss or expired, fetch from spaceURL.
	config, err := c.fetchConfig(ctx, spaceURL)
	if err != nil {
		// Fall back to persistent domain store if available.
		if c.domainStore != nil {
			if cached, ok := c.domainStore.LookupCachedConfig(ctx, spaceURL); ok {
				return cached, nil
			}
		}
		return SpaceConfigResponse{}, err
	}

	// Store in in-memory cache.
	c.cache.Add(spaceURL, spacePeerEntry{
		config:    config,
		expiresAt: time.Now().Add(c.ttl),
	})

	return config, nil
}

// getAddrInfo resolves a spaceURL to peer.AddrInfo, using the cache when possible.
// It calls GET {spaceURL}/hm/api/config and parses the response.
func (c *spacePeerResolver) getAddrInfo(ctx context.Context, spaceURL string) (peer.AddrInfo, error) {
	config, err := c.getConfig(ctx, spaceURL)
	if err != nil {
		return peer.AddrInfo{}, err
	}
	return config.AddrInfo()
}

// getPeerID resolves a spaceURL to a peer ID, using the cache when possible.
// It calls GET {spaceURL}/hm/api/config and parses the peerId field.
// This is a convenience method that calls getAddrInfo and returns only the peer ID.
func (c *spacePeerResolver) getPeerID(ctx context.Context, spaceURL string) (peer.ID, error) {
	addrInfo, err := c.getAddrInfo(ctx, spaceURL)
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
func (c *spacePeerResolver) fetchConfig(ctx context.Context, spaceURL string) (SpaceConfigResponse, error) {
	const maxRetries = 3
	const retryDelay = 300 * time.Millisecond

	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			select {
			case <-time.After(retryDelay):
			case <-ctx.Done():
				return SpaceConfigResponse{}, ctx.Err()
			}
		}

		config, err := c.doFetchConfig(ctx, spaceURL)
		if err == nil {
			return config, nil
		}

		lastErr = err

		// Only retry transient errors.
		var te transientError
		if !errors.As(err, &te) {
			return SpaceConfigResponse{}, err
		}
	}
	return SpaceConfigResponse{}, fmt.Errorf("failed after %d retries: %w", maxRetries, lastErr)
}

// doFetchConfig performs a single fetch attempt.
// It wraps transient errors (network errors, 5xx) so they can be retried.
func (c *spacePeerResolver) doFetchConfig(ctx context.Context, spaceURL string) (SpaceConfigResponse, error) {
	configURL := spaceURL + "/hm/api/config"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, configURL, nil)
	if err != nil {
		return SpaceConfigResponse{}, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		// Network errors are transient.
		return SpaceConfigResponse{}, transientError{fmt.Errorf("failed to fetch config: %w", err)}
	}
	defer resp.Body.Close()

	// 5xx errors are transient (server issues).
	if resp.StatusCode >= 500 && resp.StatusCode < 600 {
		return SpaceConfigResponse{}, transientError{fmt.Errorf("config endpoint returned status %d", resp.StatusCode)}
	}

	// Other non-200 errors are not transient (4xx are client errors).
	if resp.StatusCode != http.StatusOK {
		return SpaceConfigResponse{}, fmt.Errorf("config endpoint returned status %d", resp.StatusCode)
	}

	var result SpaceConfigResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return SpaceConfigResponse{}, fmt.Errorf("failed to decode response: %w", err)
	}

	return result, nil
}
