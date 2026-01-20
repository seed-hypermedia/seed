package atproto

import (
	"context"
	"fmt"
	"net/url"
	"time"
)

// Post represents a Bluesky post.
type Post struct {
	URI       string        `json:"uri"`
	CID       string        `json:"cid"`
	Author    *ProfileBasic `json:"author"`
	Record    *PostRecord   `json:"record"`
	Embed     *Embed        `json:"embed,omitempty"`
	ReplyCount int64        `json:"replyCount"`
	RepostCount int64       `json:"repostCount"`
	LikeCount   int64       `json:"likeCount"`
	IndexedAt   time.Time   `json:"indexedAt"`
	Viewer      *PostViewer `json:"viewer,omitempty"`
	Labels      []Label     `json:"labels,omitempty"`
}

// PostRecord is the actual post content record.
type PostRecord struct {
	Type      string    `json:"$type"`
	Text      string    `json:"text"`
	CreatedAt time.Time `json:"createdAt"`
	Facets    []Facet   `json:"facets,omitempty"`
	Reply     *ReplyRef `json:"reply,omitempty"`
	Embed     any       `json:"embed,omitempty"`
	Langs     []string  `json:"langs,omitempty"`
}

// Facet represents a rich text facet (mention, link, tag).
type Facet struct {
	Index    FacetIndex    `json:"index"`
	Features []FacetFeature `json:"features"`
}

// FacetIndex is the byte range of a facet.
type FacetIndex struct {
	ByteStart int `json:"byteStart"`
	ByteEnd   int `json:"byteEnd"`
}

// FacetFeature is a facet type.
type FacetFeature struct {
	Type string `json:"$type"`
	DID  string `json:"did,omitempty"` // For mentions
	URI  string `json:"uri,omitempty"` // For links
	Tag  string `json:"tag,omitempty"` // For hashtags
}

// ReplyRef references parent and root posts for replies.
type ReplyRef struct {
	Root   StrongRef `json:"root"`
	Parent StrongRef `json:"parent"`
}

// StrongRef is a reference to a record by URI and CID.
type StrongRef struct {
	URI string `json:"uri"`
	CID string `json:"cid"`
}

// PostViewer contains viewer state for a post.
type PostViewer struct {
	Repost string `json:"repost,omitempty"`
	Like   string `json:"like,omitempty"`
}

// Embed represents embedded content in a post.
type Embed struct {
	Type     string           `json:"$type"`
	Images   []ImageView      `json:"images,omitempty"`
	External *ExternalView    `json:"external,omitempty"`
	Record   *EmbeddedRecord  `json:"record,omitempty"`
	Media    *Embed           `json:"media,omitempty"`
}

// ImageView is an embedded image.
type ImageView struct {
	Thumb       string       `json:"thumb"`
	Fullsize    string       `json:"fullsize"`
	Alt         string       `json:"alt"`
	AspectRatio *AspectRatio `json:"aspectRatio,omitempty"`
}

// AspectRatio defines image dimensions.
type AspectRatio struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

// ExternalView is an external link embed.
type ExternalView struct {
	URI         string `json:"uri"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Thumb       string `json:"thumb,omitempty"`
}

// EmbeddedRecord is a quoted/embedded record.
type EmbeddedRecord struct {
	Type   string `json:"$type,omitempty"`
	URI    string `json:"uri,omitempty"`
	CID    string `json:"cid,omitempty"`
	Author *ProfileBasic `json:"author,omitempty"`
	Value  *PostRecord   `json:"value,omitempty"`
}

// FeedItem is an item in the feed.
type FeedItem struct {
	Post   *Post        `json:"post"`
	Reply  *ReplyContext `json:"reply,omitempty"`
	Reason *FeedReason  `json:"reason,omitempty"`
}

// ReplyContext provides context for replies.
type ReplyContext struct {
	Root   *Post `json:"root,omitempty"`
	Parent *Post `json:"parent,omitempty"`
}

// FeedReason explains why a post is in the feed.
type FeedReason struct {
	Type      string        `json:"$type"`
	By        *ProfileBasic `json:"by,omitempty"`
	IndexedAt time.Time     `json:"indexedAt,omitempty"`
}

// GetTimelineParams are parameters for getting the timeline.
type GetTimelineParams struct {
	Algorithm string
	Limit     int
	Cursor    string
}

// TimelineResult contains timeline results.
type TimelineResult struct {
	Feed   []*FeedItem `json:"feed"`
	Cursor string      `json:"cursor,omitempty"`
}

// GetTimeline gets the authenticated user's timeline.
func (c *Client) GetTimeline(ctx context.Context, params GetTimelineParams) (*TimelineResult, error) {
	urlParams := url.Values{}
	if params.Algorithm != "" {
		urlParams.Set("algorithm", params.Algorithm)
	}
	if params.Limit > 0 {
		urlParams.Set("limit", fmt.Sprintf("%d", params.Limit))
	}
	if params.Cursor != "" {
		urlParams.Set("cursor", params.Cursor)
	}

	var result TimelineResult
	err := c.xrpcCall(ctx, "GET", "app.bsky.feed.getTimeline", urlParams, nil, &result)
	if err != nil {
		return nil, fmt.Errorf("get timeline: %w", err)
	}

	return &result, nil
}

// GetAuthorFeed gets posts by a specific author.
func (c *Client) GetAuthorFeed(ctx context.Context, actor string, limit int, cursor string) (*TimelineResult, error) {
	params := url.Values{}
	params.Set("actor", actor)
	if limit > 0 {
		params.Set("limit", fmt.Sprintf("%d", limit))
	}
	if cursor != "" {
		params.Set("cursor", cursor)
	}

	var result TimelineResult
	err := c.xrpcCall(ctx, "GET", "app.bsky.feed.getAuthorFeed", params, nil, &result)
	if err != nil {
		return nil, fmt.Errorf("get author feed: %w", err)
	}

	return &result, nil
}

// GetPostThread gets a post with its thread context.
func (c *Client) GetPostThread(ctx context.Context, uri string, depth int) (*ThreadResult, error) {
	params := url.Values{}
	params.Set("uri", uri)
	if depth > 0 {
		params.Set("depth", fmt.Sprintf("%d", depth))
	}

	var result ThreadResult
	err := c.xrpcCall(ctx, "GET", "app.bsky.feed.getPostThread", params, nil, &result)
	if err != nil {
		return nil, fmt.Errorf("get post thread: %w", err)
	}

	return &result, nil
}

// ThreadResult contains a post thread.
type ThreadResult struct {
	Thread *ThreadViewPost `json:"thread"`
}

// ThreadViewPost is a post in a thread with replies.
type ThreadViewPost struct {
	Type    string             `json:"$type"`
	Post    *Post              `json:"post,omitempty"`
	Parent  *ThreadViewPost    `json:"parent,omitempty"`
	Replies []*ThreadViewPost  `json:"replies,omitempty"`
}

// GetPosts gets multiple posts by URI.
func (c *Client) GetPosts(ctx context.Context, uris []string) ([]*Post, error) {
	params := url.Values{}
	for _, uri := range uris {
		params.Add("uris", uri)
	}

	var result struct {
		Posts []*Post `json:"posts"`
	}

	err := c.xrpcCall(ctx, "GET", "app.bsky.feed.getPosts", params, nil, &result)
	if err != nil {
		return nil, fmt.Errorf("get posts: %w", err)
	}

	return result.Posts, nil
}

// GetLikes gets likes for a post.
func (c *Client) GetLikes(ctx context.Context, uri string, limit int, cursor string) (*LikesResult, error) {
	params := url.Values{}
	params.Set("uri", uri)
	if limit > 0 {
		params.Set("limit", fmt.Sprintf("%d", limit))
	}
	if cursor != "" {
		params.Set("cursor", cursor)
	}

	var result LikesResult
	err := c.xrpcCall(ctx, "GET", "app.bsky.feed.getLikes", params, nil, &result)
	if err != nil {
		return nil, fmt.Errorf("get likes: %w", err)
	}

	return &result, nil
}

// LikesResult contains likes for a post.
type LikesResult struct {
	URI    string  `json:"uri"`
	Likes  []Like  `json:"likes"`
	Cursor string  `json:"cursor,omitempty"`
}

// Like represents a like on a post.
type Like struct {
	IndexedAt time.Time     `json:"indexedAt"`
	CreatedAt time.Time     `json:"createdAt"`
	Actor     *ProfileBasic `json:"actor"`
}

// GetRepostedBy gets users who reposted a post.
func (c *Client) GetRepostedBy(ctx context.Context, uri string, limit int, cursor string) (*RepostedByResult, error) {
	params := url.Values{}
	params.Set("uri", uri)
	if limit > 0 {
		params.Set("limit", fmt.Sprintf("%d", limit))
	}
	if cursor != "" {
		params.Set("cursor", cursor)
	}

	var result RepostedByResult
	err := c.xrpcCall(ctx, "GET", "app.bsky.feed.getRepostedBy", params, nil, &result)
	if err != nil {
		return nil, fmt.Errorf("get reposted by: %w", err)
	}

	return &result, nil
}

// RepostedByResult contains users who reposted.
type RepostedByResult struct {
	URI        string          `json:"uri"`
	RepostedBy []*ProfileBasic `json:"repostedBy"`
	Cursor     string          `json:"cursor,omitempty"`
}
