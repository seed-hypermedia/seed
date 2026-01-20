package atproto

import (
	"context"
	"fmt"
	"net/url"
	"time"
)

// Follow represents a follow relationship.
type Follow struct {
	DID         string    `json:"did"`
	Handle      string    `json:"handle"`
	DisplayName string    `json:"displayName,omitempty"`
	Avatar      string    `json:"avatar,omitempty"`
	IndexedAt   time.Time `json:"indexedAt,omitempty"`
}

// GetFollows gets accounts that an actor follows.
func (c *Client) GetFollows(ctx context.Context, actor string, limit int, cursor string) (*FollowsResult, error) {
	params := url.Values{}
	params.Set("actor", actor)
	if limit > 0 {
		params.Set("limit", fmt.Sprintf("%d", limit))
	}
	if cursor != "" {
		params.Set("cursor", cursor)
	}

	var result FollowsResult
	err := c.xrpcCall(ctx, "GET", "app.bsky.graph.getFollows", params, nil, &result)
	if err != nil {
		return nil, fmt.Errorf("get follows: %w", err)
	}

	return &result, nil
}

// FollowsResult contains following accounts.
type FollowsResult struct {
	Subject *ProfileBasic   `json:"subject"`
	Follows []*ProfileBasic `json:"follows"`
	Cursor  string          `json:"cursor,omitempty"`
}

// GetFollowers gets accounts that follow an actor.
func (c *Client) GetFollowers(ctx context.Context, actor string, limit int, cursor string) (*FollowersResult, error) {
	params := url.Values{}
	params.Set("actor", actor)
	if limit > 0 {
		params.Set("limit", fmt.Sprintf("%d", limit))
	}
	if cursor != "" {
		params.Set("cursor", cursor)
	}

	var result FollowersResult
	err := c.xrpcCall(ctx, "GET", "app.bsky.graph.getFollowers", params, nil, &result)
	if err != nil {
		return nil, fmt.Errorf("get followers: %w", err)
	}

	return &result, nil
}

// FollowersResult contains follower accounts.
type FollowersResult struct {
	Subject   *ProfileBasic   `json:"subject"`
	Followers []*ProfileBasic `json:"followers"`
	Cursor    string          `json:"cursor,omitempty"`
}

// GetBlocks gets blocked accounts.
func (c *Client) GetBlocks(ctx context.Context, limit int, cursor string) (*BlocksResult, error) {
	params := url.Values{}
	if limit > 0 {
		params.Set("limit", fmt.Sprintf("%d", limit))
	}
	if cursor != "" {
		params.Set("cursor", cursor)
	}

	var result BlocksResult
	err := c.xrpcCall(ctx, "GET", "app.bsky.graph.getBlocks", params, nil, &result)
	if err != nil {
		return nil, fmt.Errorf("get blocks: %w", err)
	}

	return &result, nil
}

// BlocksResult contains blocked accounts.
type BlocksResult struct {
	Blocks []*ProfileBasic `json:"blocks"`
	Cursor string          `json:"cursor,omitempty"`
}

// GetMutes gets muted accounts.
func (c *Client) GetMutes(ctx context.Context, limit int, cursor string) (*MutesResult, error) {
	params := url.Values{}
	if limit > 0 {
		params.Set("limit", fmt.Sprintf("%d", limit))
	}
	if cursor != "" {
		params.Set("cursor", cursor)
	}

	var result MutesResult
	err := c.xrpcCall(ctx, "GET", "app.bsky.graph.getMutes", params, nil, &result)
	if err != nil {
		return nil, fmt.Errorf("get mutes: %w", err)
	}

	return &result, nil
}

// MutesResult contains muted accounts.
type MutesResult struct {
	Mutes  []*ProfileBasic `json:"mutes"`
	Cursor string          `json:"cursor,omitempty"`
}
