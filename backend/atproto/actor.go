package atproto

import (
	"context"
	"fmt"
	"net/url"
	"time"
)

// Profile represents a Bluesky actor profile.
type Profile struct {
	DID            string    `json:"did"`
	Handle         string    `json:"handle"`
	DisplayName    string    `json:"displayName,omitempty"`
	Description    string    `json:"description,omitempty"`
	Avatar         string    `json:"avatar,omitempty"`
	Banner         string    `json:"banner,omitempty"`
	FollowersCount int64     `json:"followersCount"`
	FollowsCount   int64     `json:"followsCount"`
	PostsCount     int64     `json:"postsCount"`
	IndexedAt      time.Time `json:"indexedAt"`
	Viewer         *Viewer   `json:"viewer,omitempty"`
	Labels         []Label   `json:"labels,omitempty"`
}

// Viewer contains relationship info from the viewer's perspective.
type Viewer struct {
	Muted       bool   `json:"muted,omitempty"`
	BlockedBy   bool   `json:"blockedBy,omitempty"`
	Blocking    string `json:"blocking,omitempty"`
	Following   string `json:"following,omitempty"`
	FollowedBy  string `json:"followedBy,omitempty"`
}

// Label represents a content label.
type Label struct {
	Src string    `json:"src"`
	URI string    `json:"uri"`
	Val string    `json:"val"`
	Cts time.Time `json:"cts"`
}

// ProfileBasic is a minimal profile representation.
type ProfileBasic struct {
	DID         string  `json:"did"`
	Handle      string  `json:"handle"`
	DisplayName string  `json:"displayName,omitempty"`
	Avatar      string  `json:"avatar,omitempty"`
	Viewer      *Viewer `json:"viewer,omitempty"`
	Labels      []Label `json:"labels,omitempty"`
}

// GetProfile fetches a profile by actor identifier (DID or handle).
func (c *Client) GetProfile(ctx context.Context, actor string) (*Profile, error) {
	params := url.Values{}
	params.Set("actor", actor)

	var result Profile
	err := c.xrpcCall(ctx, "GET", "app.bsky.actor.getProfile", params, nil, &result)
	if err != nil {
		return nil, fmt.Errorf("get profile: %w", err)
	}

	return &result, nil
}

// GetProfiles fetches multiple profiles at once.
func (c *Client) GetProfiles(ctx context.Context, actors []string) ([]*Profile, error) {
	params := url.Values{}
	for _, actor := range actors {
		params.Add("actors", actor)
	}

	var result struct {
		Profiles []*Profile `json:"profiles"`
	}

	err := c.xrpcCall(ctx, "GET", "app.bsky.actor.getProfiles", params, nil, &result)
	if err != nil {
		return nil, fmt.Errorf("get profiles: %w", err)
	}

	return result.Profiles, nil
}

// SearchActorsParams are parameters for actor search.
type SearchActorsParams struct {
	Query  string
	Limit  int
	Cursor string
}

// SearchActorsResult contains search results.
type SearchActorsResult struct {
	Actors []*ProfileBasic `json:"actors"`
	Cursor string          `json:"cursor,omitempty"`
}

// SearchActors searches for actors by query.
func (c *Client) SearchActors(ctx context.Context, params SearchActorsParams) (*SearchActorsResult, error) {
	urlParams := url.Values{}
	urlParams.Set("q", params.Query)
	if params.Limit > 0 {
		urlParams.Set("limit", fmt.Sprintf("%d", params.Limit))
	}
	if params.Cursor != "" {
		urlParams.Set("cursor", params.Cursor)
	}

	var result SearchActorsResult
	err := c.xrpcCall(ctx, "GET", "app.bsky.actor.searchActors", urlParams, nil, &result)
	if err != nil {
		return nil, fmt.Errorf("search actors: %w", err)
	}

	return &result, nil
}

// SearchActorsTypeahead performs a typeahead search for actors.
func (c *Client) SearchActorsTypeahead(ctx context.Context, query string, limit int) ([]*ProfileBasic, error) {
	params := url.Values{}
	params.Set("q", query)
	if limit > 0 {
		params.Set("limit", fmt.Sprintf("%d", limit))
	}

	var result struct {
		Actors []*ProfileBasic `json:"actors"`
	}

	err := c.xrpcCall(ctx, "GET", "app.bsky.actor.searchActorsTypeahead", params, nil, &result)
	if err != nil {
		return nil, fmt.Errorf("search actors typeahead: %w", err)
	}

	return result.Actors, nil
}

// GetSuggestions gets follow suggestions.
func (c *Client) GetSuggestions(ctx context.Context, limit int, cursor string) (*SearchActorsResult, error) {
	params := url.Values{}
	if limit > 0 {
		params.Set("limit", fmt.Sprintf("%d", limit))
	}
	if cursor != "" {
		params.Set("cursor", cursor)
	}

	var result SearchActorsResult
	err := c.xrpcCall(ctx, "GET", "app.bsky.actor.getSuggestions", params, nil, &result)
	if err != nil {
		return nil, fmt.Errorf("get suggestions: %w", err)
	}

	return &result, nil
}
