package atproto

import (
	"context"
	"fmt"
	"time"

	nanoid "github.com/matoous/go-nanoid/v2"
)

// RecordResult is the result of creating/updating a record.
type RecordResult struct {
	URI string `json:"uri"`
	CID string `json:"cid"`
}

// CreateRecord creates a new record in a repository.
func (c *Client) CreateRecord(ctx context.Context, repo, collection string, record any) (*RecordResult, error) {
	// Generate a TID (timestamp-based ID) for the record key
	rkey, err := generateTID()
	if err != nil {
		return nil, fmt.Errorf("generate rkey: %w", err)
	}

	body := map[string]any{
		"repo":       repo,
		"collection": collection,
		"rkey":       rkey,
		"record":     record,
	}

	var result RecordResult
	err = c.xrpcCall(ctx, "POST", "com.atproto.repo.createRecord", nil, body, &result)
	if err != nil {
		return nil, fmt.Errorf("create record: %w", err)
	}

	return &result, nil
}

// DeleteRecord deletes a record from a repository.
func (c *Client) DeleteRecord(ctx context.Context, repo, collection, rkey string) error {
	body := map[string]any{
		"repo":       repo,
		"collection": collection,
		"rkey":       rkey,
	}

	err := c.xrpcCall(ctx, "POST", "com.atproto.repo.deleteRecord", nil, body, nil)
	if err != nil {
		return fmt.Errorf("delete record: %w", err)
	}

	return nil
}

// CreatePostParams are parameters for creating a post.
type CreatePostParams struct {
	Text    string
	ReplyTo *ReplyRef
	Facets  []Facet
	Langs   []string
	Embed   any
}

// CreatePost creates a new post.
func (c *Client) CreatePost(ctx context.Context, params CreatePostParams) (*RecordResult, error) {
	c.mu.RLock()
	did := c.did
	c.mu.RUnlock()

	if did == "" {
		return nil, fmt.Errorf("not authenticated")
	}

	record := map[string]any{
		"$type":     "app.bsky.feed.post",
		"text":      params.Text,
		"createdAt": time.Now().UTC().Format(time.RFC3339Nano),
	}

	if params.ReplyTo != nil {
		record["reply"] = params.ReplyTo
	}
	if len(params.Facets) > 0 {
		record["facets"] = params.Facets
	}
	if len(params.Langs) > 0 {
		record["langs"] = params.Langs
	}
	if params.Embed != nil {
		record["embed"] = params.Embed
	}

	return c.CreateRecord(ctx, did, "app.bsky.feed.post", record)
}

// DeletePost deletes a post by URI.
func (c *Client) DeletePost(ctx context.Context, uri string) error {
	repo, collection, rkey, err := parseATURI(uri)
	if err != nil {
		return fmt.Errorf("parse uri: %w", err)
	}

	if collection != "app.bsky.feed.post" {
		return fmt.Errorf("not a post uri")
	}

	return c.DeleteRecord(ctx, repo, collection, rkey)
}

// Follow creates a follow relationship.
func (c *Client) Follow(ctx context.Context, subject string) (*RecordResult, error) {
	c.mu.RLock()
	did := c.did
	c.mu.RUnlock()

	if did == "" {
		return nil, fmt.Errorf("not authenticated")
	}

	record := map[string]any{
		"$type":     "app.bsky.graph.follow",
		"subject":   subject,
		"createdAt": time.Now().UTC().Format(time.RFC3339Nano),
	}

	return c.CreateRecord(ctx, did, "app.bsky.graph.follow", record)
}

// Unfollow removes a follow relationship.
func (c *Client) Unfollow(ctx context.Context, followURI string) error {
	repo, collection, rkey, err := parseATURI(followURI)
	if err != nil {
		return fmt.Errorf("parse uri: %w", err)
	}

	if collection != "app.bsky.graph.follow" {
		return fmt.Errorf("not a follow uri")
	}

	return c.DeleteRecord(ctx, repo, collection, rkey)
}

// UnfollowBySubject unfollows by looking up the follow record.
func (c *Client) UnfollowBySubject(ctx context.Context, subjectDID string) error {
	c.mu.RLock()
	did := c.did
	c.mu.RUnlock()

	if did == "" {
		return fmt.Errorf("not authenticated")
	}

	// Get the profile to find the follow URI
	profile, err := c.GetProfile(ctx, subjectDID)
	if err != nil {
		return fmt.Errorf("get profile: %w", err)
	}

	if profile.Viewer == nil || profile.Viewer.Following == "" {
		return nil // Not following
	}

	return c.Unfollow(ctx, profile.Viewer.Following)
}

// Like creates a like on a post.
func (c *Client) Like(ctx context.Context, uri, cid string) (*RecordResult, error) {
	c.mu.RLock()
	did := c.did
	c.mu.RUnlock()

	if did == "" {
		return nil, fmt.Errorf("not authenticated")
	}

	record := map[string]any{
		"$type": "app.bsky.feed.like",
		"subject": map[string]string{
			"uri": uri,
			"cid": cid,
		},
		"createdAt": time.Now().UTC().Format(time.RFC3339Nano),
	}

	return c.CreateRecord(ctx, did, "app.bsky.feed.like", record)
}

// Unlike removes a like.
func (c *Client) Unlike(ctx context.Context, likeURI string) error {
	repo, collection, rkey, err := parseATURI(likeURI)
	if err != nil {
		return fmt.Errorf("parse uri: %w", err)
	}

	if collection != "app.bsky.feed.like" {
		return fmt.Errorf("not a like uri")
	}

	return c.DeleteRecord(ctx, repo, collection, rkey)
}

// Repost creates a repost of a post.
func (c *Client) Repost(ctx context.Context, uri, cid string) (*RecordResult, error) {
	c.mu.RLock()
	did := c.did
	c.mu.RUnlock()

	if did == "" {
		return nil, fmt.Errorf("not authenticated")
	}

	record := map[string]any{
		"$type": "app.bsky.feed.repost",
		"subject": map[string]string{
			"uri": uri,
			"cid": cid,
		},
		"createdAt": time.Now().UTC().Format(time.RFC3339Nano),
	}

	return c.CreateRecord(ctx, did, "app.bsky.feed.repost", record)
}

// Unrepost removes a repost.
func (c *Client) Unrepost(ctx context.Context, repostURI string) error {
	repo, collection, rkey, err := parseATURI(repostURI)
	if err != nil {
		return fmt.Errorf("parse uri: %w", err)
	}

	if collection != "app.bsky.feed.repost" {
		return fmt.Errorf("not a repost uri")
	}

	return c.DeleteRecord(ctx, repo, collection, rkey)
}

// Block creates a block on an account.
func (c *Client) Block(ctx context.Context, subject string) (*RecordResult, error) {
	c.mu.RLock()
	did := c.did
	c.mu.RUnlock()

	if did == "" {
		return nil, fmt.Errorf("not authenticated")
	}

	record := map[string]any{
		"$type":     "app.bsky.graph.block",
		"subject":   subject,
		"createdAt": time.Now().UTC().Format(time.RFC3339Nano),
	}

	return c.CreateRecord(ctx, did, "app.bsky.graph.block", record)
}

// Unblock removes a block.
func (c *Client) Unblock(ctx context.Context, blockURI string) error {
	repo, collection, rkey, err := parseATURI(blockURI)
	if err != nil {
		return fmt.Errorf("parse uri: %w", err)
	}

	if collection != "app.bsky.graph.block" {
		return fmt.Errorf("not a block uri")
	}

	return c.DeleteRecord(ctx, repo, collection, rkey)
}

// Mute mutes an account.
func (c *Client) Mute(ctx context.Context, actor string) error {
	body := map[string]string{
		"actor": actor,
	}

	err := c.xrpcCall(ctx, "POST", "app.bsky.graph.muteActor", nil, body, nil)
	if err != nil {
		return fmt.Errorf("mute actor: %w", err)
	}

	return nil
}

// Unmute unmutes an account.
func (c *Client) Unmute(ctx context.Context, actor string) error {
	body := map[string]string{
		"actor": actor,
	}

	err := c.xrpcCall(ctx, "POST", "app.bsky.graph.unmuteActor", nil, body, nil)
	if err != nil {
		return fmt.Errorf("unmute actor: %w", err)
	}

	return nil
}

// generateTID generates a timestamp-based ID for record keys.
func generateTID() (string, error) {
	// TID format: base32-sortable timestamp + random suffix
	// For simplicity, we use a nanoid which provides similar uniqueness
	return nanoid.Generate("234567abcdefghijklmnopqrstuvwxyz", 13)
}

// parseATURI parses an AT URI into repo, collection, and rkey.
// Format: at://did:plc:xxx/app.bsky.feed.post/rkey
func parseATURI(uri string) (repo, collection, rkey string, err error) {
	if len(uri) < 6 || uri[:5] != "at://" {
		return "", "", "", fmt.Errorf("invalid AT URI: %s", uri)
	}

	path := uri[5:]
	parts := make([]string, 0, 3)
	start := 0
	for i := 0; i < len(path); i++ {
		if path[i] == '/' {
			if i > start {
				parts = append(parts, path[start:i])
			}
			start = i + 1
		}
	}
	if start < len(path) {
		parts = append(parts, path[start:])
	}

	if len(parts) != 3 {
		return "", "", "", fmt.Errorf("invalid AT URI format: %s", uri)
	}

	return parts[0], parts[1], parts[2], nil
}
