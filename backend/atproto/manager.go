package atproto

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// Connection represents a Bluesky account connection.
type Connection struct {
	SeedAccount string    `json:"seedAccount"`
	DID         string    `json:"did"`
	Handle      string    `json:"handle"`
	PDSURL      string    `json:"pdsUrl"`
	AccessJwt   string    `json:"accessJwt"`
	RefreshJwt  string    `json:"refreshJwt"`
	ConnectTime time.Time `json:"connectTime"`
}

// ConnectionStore is an interface for persisting connections.
type ConnectionStore interface {
	// Save persists a connection.
	Save(ctx context.Context, conn *Connection) error

	// Load loads a connection by Seed account ID.
	Load(ctx context.Context, seedAccount string) (*Connection, error)

	// Delete removes a connection.
	Delete(ctx context.Context, seedAccount string) error

	// List lists all connections.
	List(ctx context.Context) ([]*Connection, error)
}

// Manager manages multiple Bluesky connections.
type Manager struct {
	store   ConnectionStore
	clients map[string]*Client
	mu      sync.RWMutex
}

// NewManager creates a new connection manager.
func NewManager(store ConnectionStore) *Manager {
	return &Manager{
		store:   store,
		clients: make(map[string]*Client),
	}
}

// Connect connects a Seed account to Bluesky.
func (m *Manager) Connect(ctx context.Context, seedAccount, identifier, appPassword, pdsURL string) (*Connection, error) {
	if pdsURL == "" {
		pdsURL = DefaultPDS
	}

	client := NewClient(pdsURL)
	session, err := client.CreateSession(ctx, identifier, appPassword)
	if err != nil {
		return nil, fmt.Errorf("authenticate: %w", err)
	}

	conn := &Connection{
		SeedAccount: seedAccount,
		DID:         session.DID,
		Handle:      session.Handle,
		PDSURL:      pdsURL,
		AccessJwt:   session.AccessJwt,
		RefreshJwt:  session.RefreshJwt,
		ConnectTime: time.Now(),
	}

	if err := m.store.Save(ctx, conn); err != nil {
		return nil, fmt.Errorf("save connection: %w", err)
	}

	m.mu.Lock()
	m.clients[seedAccount] = client
	m.mu.Unlock()

	return conn, nil
}

// Disconnect disconnects a Bluesky account.
func (m *Manager) Disconnect(ctx context.Context, seedAccount string) error {
	m.mu.Lock()
	client, ok := m.clients[seedAccount]
	if ok {
		delete(m.clients, seedAccount)
	}
	m.mu.Unlock()

	if client != nil {
		// Try to delete the session, but don't fail if it doesn't work
		_ = client.DeleteSession(ctx)
	}

	if err := m.store.Delete(ctx, seedAccount); err != nil {
		return fmt.Errorf("delete connection: %w", err)
	}

	return nil
}

// GetClient gets or creates a client for a Seed account.
func (m *Manager) GetClient(ctx context.Context, seedAccount string) (*Client, error) {
	m.mu.RLock()
	client, ok := m.clients[seedAccount]
	m.mu.RUnlock()

	if ok {
		return client, nil
	}

	// Try to load from store
	conn, err := m.store.Load(ctx, seedAccount)
	if err != nil {
		return nil, fmt.Errorf("load connection: %w", err)
	}
	if conn == nil {
		return nil, fmt.Errorf("no connection for account %s", seedAccount)
	}

	// Create client and restore session
	client = NewClient(conn.PDSURL)
	client.SetSession(conn.AccessJwt, conn.RefreshJwt, conn.DID, conn.Handle)

	// Refresh the session to ensure it's valid
	session, err := client.RefreshSession(ctx)
	if err != nil {
		// Session might be expired, need to re-authenticate
		return nil, fmt.Errorf("session expired, please reconnect: %w", err)
	}

	// Update stored tokens
	conn.AccessJwt = session.AccessJwt
	conn.RefreshJwt = session.RefreshJwt
	if err := m.store.Save(ctx, conn); err != nil {
		// Log but don't fail
		_ = err
	}

	m.mu.Lock()
	m.clients[seedAccount] = client
	m.mu.Unlock()

	return client, nil
}

// GetConnection gets the connection info for a Seed account.
func (m *Manager) GetConnection(ctx context.Context, seedAccount string) (*Connection, error) {
	conn, err := m.store.Load(ctx, seedAccount)
	if err != nil {
		return nil, fmt.Errorf("load connection: %w", err)
	}
	return conn, nil
}

// ListConnections lists all connections.
func (m *Manager) ListConnections(ctx context.Context) ([]*Connection, error) {
	return m.store.List(ctx)
}

// IsConnected checks if a Seed account has a Bluesky connection.
func (m *Manager) IsConnected(ctx context.Context, seedAccount string) bool {
	conn, err := m.store.Load(ctx, seedAccount)
	return err == nil && conn != nil
}

// InMemoryStore is an in-memory implementation of ConnectionStore.
// For production, use a persistent store backed by SQLite or similar.
type InMemoryStore struct {
	connections map[string]*Connection
	mu          sync.RWMutex
}

// NewInMemoryStore creates a new in-memory store.
func NewInMemoryStore() *InMemoryStore {
	return &InMemoryStore{
		connections: make(map[string]*Connection),
	}
}

func (s *InMemoryStore) Save(ctx context.Context, conn *Connection) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.connections[conn.SeedAccount] = conn
	return nil
}

func (s *InMemoryStore) Load(ctx context.Context, seedAccount string) (*Connection, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	conn, ok := s.connections[seedAccount]
	if !ok {
		return nil, nil
	}
	return conn, nil
}

func (s *InMemoryStore) Delete(ctx context.Context, seedAccount string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.connections, seedAccount)
	return nil
}

func (s *InMemoryStore) List(ctx context.Context) ([]*Connection, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]*Connection, 0, len(s.connections))
	for _, conn := range s.connections {
		result = append(result, conn)
	}
	return result, nil
}

// MarshalJSON returns the JSON encoding of a connection without sensitive data.
func (c *Connection) MarshalJSON() ([]byte, error) {
	type alias Connection
	return json.Marshal(&struct {
		*alias
		AccessJwt  string `json:"accessJwt,omitempty"`
		RefreshJwt string `json:"refreshJwt,omitempty"`
	}{
		alias:      (*alias)(c),
		AccessJwt:  "", // Don't expose tokens
		RefreshJwt: "",
	})
}

// MarshalJSONInternal returns the JSON encoding including sensitive data (for storage).
func (c *Connection) MarshalJSONInternal() ([]byte, error) {
	type alias Connection
	return json.Marshal((*alias)(c))
}
