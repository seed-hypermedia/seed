package blob

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sync"
	"time"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"go.uber.org/zap"
)

// DomainEntry represents a cached domain configuration.
type DomainEntry struct {
	Domain      string
	LastCheck   time.Time
	LastStatus  string // "success" | "unreachable" | "error" | "unknown"
	LastSuccess time.Time
	LastConfig  *SiteConfigResponse
	LastError   string
}

// DomainStore manages a persistent cache of domain configurations in SQLite.
// It periodically polls /hm/api/config for tracked domains.
type DomainStore struct {
	db       *sqlitex.Pool
	resolver *sitePeerResolver
	log      *zap.Logger

	backgroundCtx    context.Context
	cancelBackground context.CancelFunc

	backgroundMu     sync.Mutex
	backgroundClosed bool
	backgroundWG     sync.WaitGroup
}

// NewDomainStore creates a new domain store backed by the given database pool.
// It reuses the sitePeerResolver for fetching configs from remote servers.
func NewDomainStore(db *sqlitex.Pool, resolver *sitePeerResolver, log *zap.Logger) *DomainStore {
	backgroundCtx, cancelBackground := context.WithCancel(context.Background())

	return &DomainStore{
		db:               db,
		resolver:         resolver,
		log:              log,
		backgroundCtx:    backgroundCtx,
		cancelBackground: cancelBackground,
	}
}

// Close stops background domain checks and waits for them to exit.
func (ds *DomainStore) Close() error {
	ds.backgroundMu.Lock()
	if ds.backgroundClosed {
		ds.backgroundMu.Unlock()
		return nil
	}
	ds.backgroundClosed = true
	cancelBackground := ds.cancelBackground
	ds.backgroundMu.Unlock()

	cancelBackground()
	ds.backgroundWG.Wait()
	return nil
}

// PutDomain adds or updates a domain to be tracked.
// If the domain already exists, this is a no-op.
func (ds *DomainStore) PutDomain(ctx context.Context, domain string) error {
	return ds.db.WithTx(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn,
			"INSERT OR IGNORE INTO domains (domain) VALUES (?)",
			nil, domain)
	})
}

// RemoveDomain stops tracking a domain and removes its cached data.
func (ds *DomainStore) RemoveDomain(ctx context.Context, domain string) error {
	return ds.db.WithTx(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn,
			"DELETE FROM domains WHERE domain = ?",
			nil, domain)
	})
}

// GetDomain returns the cached information for a domain.
func (ds *DomainStore) GetDomain(ctx context.Context, domain string) (DomainEntry, error) {
	var entry DomainEntry
	var found bool
	if err := ds.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn,
			"SELECT domain, last_check, last_status, last_success, last_config, last_error FROM domains WHERE domain = ?",
			func(stmt *sqlite.Stmt) error {
				found = true
				entry = scanDomainEntry(stmt)
				return nil
			}, domain)
	}); err != nil {
		return DomainEntry{}, err
	}
	if !found {
		return DomainEntry{}, fmt.Errorf("domain not found: %s", domain)
	}
	return entry, nil
}

// ListDomains returns all tracked domains.
func (ds *DomainStore) ListDomains(ctx context.Context) ([]DomainEntry, error) {
	var entries []DomainEntry
	if err := ds.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn,
			"SELECT domain, last_check, last_status, last_success, last_config, last_error FROM domains ORDER BY domain",
			func(stmt *sqlite.Stmt) error {
				entries = append(entries, scanDomainEntry(stmt))
				return nil
			})
	}); err != nil {
		return nil, err
	}
	return entries, nil
}

// CheckDomain fetches the /hm/api/config endpoint for the given domain
// and updates the cached entry. The domain is added if not already tracked.
func (ds *DomainStore) CheckDomain(ctx context.Context, domain string) (DomainEntry, error) {
	siteURL := "https://" + domain
	now := time.Now()

	config, err := ds.resolver.fetchConfig(ctx, siteURL)

	var entry DomainEntry
	entry.Domain = domain
	entry.LastCheck = now

	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return entry, err
		}

		// Determine if unreachable vs error.
		var te transientError
		if errors.As(err, &te) {
			entry.LastStatus = "unreachable"
		} else {
			entry.LastStatus = "error"
		}
		entry.LastError = err.Error()

		if dbErr := ds.updateDomainFailure(ctx, entry); dbErr != nil {
			ds.log.Warn("FailedToUpdateDomainStore", zap.String("domain", domain), zap.Error(dbErr))
		}
		return entry, nil
	}

	entry.LastStatus = "success"
	entry.LastSuccess = now
	entry.LastConfig = &config

	if dbErr := ds.updateDomainSuccess(ctx, entry); dbErr != nil {
		ds.log.Warn("FailedToUpdateDomainStore", zap.String("domain", domain), zap.Error(dbErr))
	}

	return entry, nil
}

// CheckAllDomains polls all tracked domains.
func (ds *DomainStore) CheckAllDomains(ctx context.Context) {
	entries, err := ds.ListDomains(ctx)
	if err != nil {
		ds.log.Warn("FailedToListDomains", zap.Error(err))
		return
	}

	for _, e := range entries {
		if ctx.Err() != nil {
			return
		}
		if _, err := ds.CheckDomain(ctx, e.Domain); err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
			ds.log.Debug("FailedToCheckDomain", zap.String("domain", e.Domain), zap.Error(err))
		}
	}
}

// Start begins periodic polling of all tracked domains.
// It blocks until ctx is canceled.
func (ds *DomainStore) Start(ctx context.Context) error {
	const pollInterval = 30 * time.Minute

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	// Do an initial check shortly after startup.
	initialDelay := time.NewTimer(30 * time.Second)
	defer initialDelay.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-initialDelay.C:
		ds.CheckAllDomains(ctx)
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			ds.CheckAllDomains(ctx)
		}
	}
}

// LookupCachedConfig returns the cached config for a domain, if available.
// This is used as a fallback when the network is unavailable.
func (ds *DomainStore) LookupCachedConfig(ctx context.Context, siteURL string) (SiteConfigResponse, bool) {
	domain, err := extractDomain(siteURL)
	if err != nil {
		return SiteConfigResponse{}, false
	}

	entry, err := ds.GetDomain(ctx, domain)
	if err != nil || entry.LastConfig == nil {
		return SiteConfigResponse{}, false
	}

	return *entry.LastConfig, true
}

// TrackSiteURL extracts the domain from a site URL, adds it to the store,
// and triggers a background check if the domain is new.
func (ds *DomainStore) TrackSiteURL(ctx context.Context, siteURL string) {
	domain, err := extractDomain(siteURL)
	if err != nil {
		return
	}

	// Check if already tracked with data.
	if existing, err := ds.GetDomain(ctx, domain); err == nil && existing.LastConfig != nil {
		return // Already tracked and has cached config
	}

	if err := ds.PutDomain(ctx, domain); err != nil {
		ds.log.Debug("FailedToTrackDomain", zap.String("domain", domain), zap.Error(err))
		return
	}

	// Fire background check so the cache is populated immediately.
	ds.backgroundMu.Lock()
	if ds.backgroundClosed {
		ds.backgroundMu.Unlock()
		return
	}
	ds.backgroundWG.Add(1)
	backgroundCtx := ds.backgroundCtx
	ds.backgroundMu.Unlock()

	go func() {
		defer ds.backgroundWG.Done()

		if _, err := ds.CheckDomain(backgroundCtx, domain); err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
			ds.log.Debug("FailedInitialDomainCheck", zap.String("domain", domain), zap.Error(err))
		}
	}()
}

func (ds *DomainStore) updateDomainSuccess(ctx context.Context, entry DomainEntry) error {
	configJSON, err := json.Marshal(entry.LastConfig)
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	return ds.db.WithTx(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, `INSERT INTO domains (domain, last_check, last_status, last_success, last_config, last_error)
VALUES (?, ?, 'success', ?, ?, NULL)
ON CONFLICT(domain) DO UPDATE SET
last_check = excluded.last_check,
last_status = 'success',
last_success = excluded.last_success,
last_config = excluded.last_config,
last_error = NULL`, nil,
			entry.Domain,
			entry.LastCheck.Unix(),
			entry.LastSuccess.Unix(),
			string(configJSON),
		)
	})
}

func (ds *DomainStore) updateDomainFailure(ctx context.Context, entry DomainEntry) error {
	return ds.db.WithTx(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, `INSERT INTO domains (domain, last_check, last_status, last_error)
VALUES (?, ?, ?, ?)
ON CONFLICT(domain) DO UPDATE SET
last_check = excluded.last_check,
last_status = excluded.last_status,
last_error = excluded.last_error`, nil,
			entry.Domain,
			entry.LastCheck.Unix(),
			entry.LastStatus,
			entry.LastError,
		)
	})
}

func scanDomainEntry(stmt *sqlite.Stmt) DomainEntry {
	entry := DomainEntry{
		Domain:     stmt.ColumnText(0),
		LastStatus: stmt.ColumnText(2),
		LastError:  stmt.ColumnText(5),
	}

	if lastCheck := stmt.ColumnInt64(1); lastCheck != 0 {
		entry.LastCheck = time.Unix(lastCheck, 0)
	}
	if lastSuccess := stmt.ColumnInt64(3); lastSuccess != 0 {
		entry.LastSuccess = time.Unix(lastSuccess, 0)
	}

	if configStr := stmt.ColumnText(4); configStr != "" {
		var config SiteConfigResponse
		if err := json.Unmarshal([]byte(configStr), &config); err == nil {
			entry.LastConfig = &config
		}
	}

	return entry
}

func extractDomain(siteURL string) (string, error) {
	u, err := url.Parse(siteURL)
	if err != nil {
		return "", err
	}
	host := u.Hostname()
	if host == "" {
		return "", fmt.Errorf("no hostname in URL: %s", siteURL)
	}
	return host, nil
}
