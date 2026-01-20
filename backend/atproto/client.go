// Package atproto provides a client for interacting with AT Protocol (Bluesky) servers.
package atproto

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	// DefaultPDS is the default Personal Data Server URL.
	DefaultPDS = "https://bsky.social"

	// DefaultTimeout is the default HTTP timeout.
	DefaultTimeout = 30 * time.Second
)

// Client is an AT Protocol XRPC client.
type Client struct {
	pdsURL     string
	httpClient *http.Client

	mu          sync.RWMutex
	accessJwt   string
	refreshJwt  string
	did         string
	handle      string
	expireTime  time.Time
}

// NewClient creates a new AT Protocol client.
func NewClient(pdsURL string) *Client {
	if pdsURL == "" {
		pdsURL = DefaultPDS
	}
	// Ensure URL doesn't have trailing slash
	pdsURL = strings.TrimSuffix(pdsURL, "/")

	return &Client{
		pdsURL: pdsURL,
		httpClient: &http.Client{
			Timeout: DefaultTimeout,
		},
	}
}

// Session holds authentication session data.
type Session struct {
	AccessJwt  string `json:"accessJwt"`
	RefreshJwt string `json:"refreshJwt"`
	Handle     string `json:"handle"`
	DID        string `json:"did"`
	Email      string `json:"email,omitempty"`
}

// CreateSession authenticates with the PDS and creates a session.
func (c *Client) CreateSession(ctx context.Context, identifier, password string) (*Session, error) {
	body := map[string]string{
		"identifier": identifier,
		"password":   password,
	}

	var session Session
	err := c.xrpcCall(ctx, "POST", "com.atproto.server.createSession", nil, body, &session)
	if err != nil {
		return nil, fmt.Errorf("create session: %w", err)
	}

	c.mu.Lock()
	c.accessJwt = session.AccessJwt
	c.refreshJwt = session.RefreshJwt
	c.did = session.DID
	c.handle = session.Handle
	// JWT typically expires in 2 hours, refresh before that
	c.expireTime = time.Now().Add(90 * time.Minute)
	c.mu.Unlock()

	return &session, nil
}

// RefreshSession refreshes the authentication session.
func (c *Client) RefreshSession(ctx context.Context) (*Session, error) {
	c.mu.RLock()
	refreshJwt := c.refreshJwt
	c.mu.RUnlock()

	if refreshJwt == "" {
		return nil, fmt.Errorf("no refresh token available")
	}

	// Use refresh token for auth
	req, err := http.NewRequestWithContext(ctx, "POST",
		c.pdsURL+"/xrpc/com.atproto.server.refreshSession", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+refreshJwt)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("refresh session request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, c.parseError(resp)
	}

	var session Session
	if err := json.NewDecoder(resp.Body).Decode(&session); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	c.mu.Lock()
	c.accessJwt = session.AccessJwt
	c.refreshJwt = session.RefreshJwt
	c.did = session.DID
	c.handle = session.Handle
	c.expireTime = time.Now().Add(90 * time.Minute)
	c.mu.Unlock()

	return &session, nil
}

// DeleteSession logs out and deletes the current session.
func (c *Client) DeleteSession(ctx context.Context) error {
	err := c.xrpcCall(ctx, "POST", "com.atproto.server.deleteSession", nil, nil, nil)
	if err != nil {
		return fmt.Errorf("delete session: %w", err)
	}

	c.mu.Lock()
	c.accessJwt = ""
	c.refreshJwt = ""
	c.did = ""
	c.handle = ""
	c.expireTime = time.Time{}
	c.mu.Unlock()

	return nil
}

// SetSession sets the session tokens directly (for restoring from storage).
func (c *Client) SetSession(accessJwt, refreshJwt, did, handle string) {
	c.mu.Lock()
	c.accessJwt = accessJwt
	c.refreshJwt = refreshJwt
	c.did = did
	c.handle = handle
	c.expireTime = time.Now().Add(90 * time.Minute)
	c.mu.Unlock()
}

// GetSession returns the current session info.
func (c *Client) GetSession() (did, handle string, isAuthenticated bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.did, c.handle, c.accessJwt != ""
}

// IsAuthenticated returns whether the client has an active session.
func (c *Client) IsAuthenticated() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.accessJwt != ""
}

// PDSURL returns the PDS URL.
func (c *Client) PDSURL() string {
	return c.pdsURL
}

// xrpcCall makes an XRPC API call.
func (c *Client) xrpcCall(ctx context.Context, method, nsid string, params url.Values, body interface{}, result interface{}) error {
	// Check if we need to refresh the session
	c.mu.RLock()
	needsRefresh := c.accessJwt != "" && time.Now().After(c.expireTime)
	c.mu.RUnlock()

	if needsRefresh {
		if _, err := c.RefreshSession(ctx); err != nil {
			// Log but don't fail - the call might still work
			_ = err
		}
	}

	endpoint := c.pdsURL + "/xrpc/" + nsid
	if params != nil && len(params) > 0 {
		endpoint += "?" + params.Encode()
	}

	var bodyReader io.Reader
	if body != nil {
		bodyBytes, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal body: %w", err)
		}
		bodyReader = bytes.NewReader(bodyBytes)
	}

	req, err := http.NewRequestWithContext(ctx, method, endpoint, bodyReader)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	c.mu.RLock()
	if c.accessJwt != "" {
		req.Header.Set("Authorization", "Bearer "+c.accessJwt)
	}
	c.mu.RUnlock()

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return c.parseError(resp)
	}

	if result != nil {
		if err := json.NewDecoder(resp.Body).Decode(result); err != nil {
			return fmt.Errorf("decode response: %w", err)
		}
	}

	return nil
}

// XRPCError represents an error from the XRPC API.
type XRPCError struct {
	StatusCode int
	Error      string `json:"error"`
	Message    string `json:"message"`
}

func (e *XRPCError) Unwrap() error {
	return nil
}

func (e *XRPCError) Is(target error) bool {
	if t, ok := target.(*XRPCError); ok {
		return e.Error == t.Error
	}
	return false
}

func (e *XRPCError) String() string {
	return fmt.Sprintf("xrpc error %d: %s - %s", e.StatusCode, e.Error, e.Message)
}

func (c *Client) parseError(resp *http.Response) error {
	var xrpcErr XRPCError
	xrpcErr.StatusCode = resp.StatusCode

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("http error %d", resp.StatusCode)
	}

	if err := json.Unmarshal(body, &xrpcErr); err != nil {
		return fmt.Errorf("http error %d: %s", resp.StatusCode, string(body))
	}

	return &xrpcErr
}
