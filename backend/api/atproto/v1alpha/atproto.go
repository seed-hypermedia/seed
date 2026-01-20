// Package atproto implements the AT Protocol (Bluesky) gRPC API.
package atproto

import (
	"context"
	"fmt"
	"seed/backend/atproto"
	"seed/backend/storage"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Server implements the ATProto gRPC API.
type Server struct {
	store   *storage.Store
	manager *atproto.Manager
}

// NewServer creates a new ATProto API server.
func NewServer(store *storage.Store, connStore atproto.ConnectionStore) *Server {
	if connStore == nil {
		connStore = atproto.NewInMemoryStore()
	}
	return &Server{
		store:   store,
		manager: atproto.NewManager(connStore),
	}
}

// RegisterServer registers the server with the gRPC server.
// Note: This will be connected once proto generation is available.
func (s *Server) RegisterServer(rpc grpc.ServiceRegistrar) {
	// atprotopb.RegisterATProtoServer(rpc, s)
	_ = rpc // Will be used when proto is generated
}

// Connect connects a Seed account to Bluesky.
func (s *Server) Connect(ctx context.Context, seedAccount, identifier, appPassword, pdsURL string) (*ConnectionResult, error) {
	if seedAccount == "" {
		return nil, status.Error(codes.InvalidArgument, "seed_account is required")
	}
	if identifier == "" {
		return nil, status.Error(codes.InvalidArgument, "identifier is required")
	}
	if appPassword == "" {
		return nil, status.Error(codes.InvalidArgument, "app_password is required")
	}

	conn, err := s.manager.Connect(ctx, seedAccount, identifier, appPassword, pdsURL)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to connect: %v", err)
	}

	// Get the profile
	client, err := s.manager.GetClient(ctx, seedAccount)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get client: %v", err)
	}

	profile, err := client.GetProfile(ctx, conn.DID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get profile: %v", err)
	}

	return &ConnectionResult{
		Status:  connectionToStatus(conn),
		Profile: profileToProto(profile),
	}, nil
}

// Disconnect disconnects a Bluesky account.
func (s *Server) Disconnect(ctx context.Context, seedAccount string) error {
	if seedAccount == "" {
		return status.Error(codes.InvalidArgument, "seed_account is required")
	}

	if err := s.manager.Disconnect(ctx, seedAccount); err != nil {
		return status.Errorf(codes.Internal, "failed to disconnect: %v", err)
	}

	return nil
}

// ListConnections lists all Bluesky connections.
func (s *Server) ListConnections(ctx context.Context) ([]*ConnectionStatus, error) {
	connections, err := s.manager.ListConnections(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list connections: %v", err)
	}

	result := make([]*ConnectionStatus, len(connections))
	for i, conn := range connections {
		result[i] = connectionToStatus(conn)
	}

	return result, nil
}

// GetConnectionStatus gets the connection status for a Seed account.
func (s *Server) GetConnectionStatus(ctx context.Context, seedAccount string) (*ConnectionStatus, error) {
	if seedAccount == "" {
		return nil, status.Error(codes.InvalidArgument, "seed_account is required")
	}

	conn, err := s.manager.GetConnection(ctx, seedAccount)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get connection: %v", err)
	}
	if conn == nil {
		return nil, status.Error(codes.NotFound, "no connection found")
	}

	return connectionToStatus(conn), nil
}

// ResolveHandle resolves a Bluesky handle to a DID.
func (s *Server) ResolveHandle(ctx context.Context, handle string) (string, error) {
	if handle == "" {
		return "", status.Error(codes.InvalidArgument, "handle is required")
	}

	client := atproto.NewClient("")
	did, err := client.ResolveHandle(ctx, handle)
	if err != nil {
		return "", status.Errorf(codes.Internal, "failed to resolve handle: %v", err)
	}

	return did, nil
}

// GetProfile gets a Bluesky profile.
func (s *Server) GetProfile(ctx context.Context, seedAccount, actor string) (*BlueskyProfile, error) {
	if seedAccount == "" {
		return nil, status.Error(codes.InvalidArgument, "seed_account is required")
	}
	if actor == "" {
		return nil, status.Error(codes.InvalidArgument, "actor is required")
	}

	client, err := s.manager.GetClient(ctx, seedAccount)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get client: %v", err)
	}

	profile, err := client.GetProfile(ctx, actor)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get profile: %v", err)
	}

	return profileToProto(profile), nil
}

// SearchActors searches for Bluesky actors.
func (s *Server) SearchActors(ctx context.Context, seedAccount, query string, limit int, cursor string) (*SearchActorsResult, error) {
	if seedAccount == "" {
		return nil, status.Error(codes.InvalidArgument, "seed_account is required")
	}
	if query == "" {
		return nil, status.Error(codes.InvalidArgument, "query is required")
	}

	client, err := s.manager.GetClient(ctx, seedAccount)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get client: %v", err)
	}

	result, err := client.SearchActors(ctx, atproto.SearchActorsParams{
		Query:  query,
		Limit:  limit,
		Cursor: cursor,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to search actors: %v", err)
	}

	actors := make([]*BlueskyProfile, len(result.Actors))
	for i, actor := range result.Actors {
		actors[i] = profileBasicToProto(actor)
	}

	return &SearchActorsResult{
		Actors: actors,
		Cursor: result.Cursor,
	}, nil
}

// GetTimeline gets the timeline for a connected account.
func (s *Server) GetTimeline(ctx context.Context, seedAccount string, limit int, cursor, algorithm string) (*TimelineResult, error) {
	if seedAccount == "" {
		return nil, status.Error(codes.InvalidArgument, "seed_account is required")
	}

	client, err := s.manager.GetClient(ctx, seedAccount)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get client: %v", err)
	}

	result, err := client.GetTimeline(ctx, atproto.GetTimelineParams{
		Algorithm: algorithm,
		Limit:     limit,
		Cursor:    cursor,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get timeline: %v", err)
	}

	feed := make([]*FeedItem, len(result.Feed))
	for i, item := range result.Feed {
		feed[i] = feedItemToProto(item)
	}

	return &TimelineResult{
		Feed:   feed,
		Cursor: result.Cursor,
	}, nil
}

// CreatePost creates a post on Bluesky.
func (s *Server) CreatePost(ctx context.Context, seedAccount, text string, replyTo *ReplyRef, langs []string) (*RecordRef, error) {
	if seedAccount == "" {
		return nil, status.Error(codes.InvalidArgument, "seed_account is required")
	}
	if text == "" {
		return nil, status.Error(codes.InvalidArgument, "text is required")
	}

	client, err := s.manager.GetClient(ctx, seedAccount)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get client: %v", err)
	}

	params := atproto.CreatePostParams{
		Text:  text,
		Langs: langs,
	}

	if replyTo != nil {
		params.ReplyTo = &atproto.ReplyRef{
			Root: atproto.StrongRef{
				URI: replyTo.RootURI,
				CID: replyTo.RootCID,
			},
			Parent: atproto.StrongRef{
				URI: replyTo.ParentURI,
				CID: replyTo.ParentCID,
			},
		}
	}

	result, err := client.CreatePost(ctx, params)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create post: %v", err)
	}

	return &RecordRef{
		URI: result.URI,
		CID: result.CID,
	}, nil
}

// DeletePost deletes a post from Bluesky.
func (s *Server) DeletePost(ctx context.Context, seedAccount, uri string) error {
	if seedAccount == "" {
		return status.Error(codes.InvalidArgument, "seed_account is required")
	}
	if uri == "" {
		return status.Error(codes.InvalidArgument, "uri is required")
	}

	client, err := s.manager.GetClient(ctx, seedAccount)
	if err != nil {
		return status.Errorf(codes.Internal, "failed to get client: %v", err)
	}

	if err := client.DeletePost(ctx, uri); err != nil {
		return status.Errorf(codes.Internal, "failed to delete post: %v", err)
	}

	return nil
}

// Follow follows a Bluesky account.
func (s *Server) Follow(ctx context.Context, seedAccount, subject string) (*RecordRef, error) {
	if seedAccount == "" {
		return nil, status.Error(codes.InvalidArgument, "seed_account is required")
	}
	if subject == "" {
		return nil, status.Error(codes.InvalidArgument, "subject is required")
	}

	client, err := s.manager.GetClient(ctx, seedAccount)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get client: %v", err)
	}

	result, err := client.Follow(ctx, subject)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to follow: %v", err)
	}

	return &RecordRef{
		URI: result.URI,
		CID: result.CID,
	}, nil
}

// Unfollow unfollows a Bluesky account.
func (s *Server) Unfollow(ctx context.Context, seedAccount, subject string) error {
	if seedAccount == "" {
		return status.Error(codes.InvalidArgument, "seed_account is required")
	}
	if subject == "" {
		return status.Error(codes.InvalidArgument, "subject is required")
	}

	client, err := s.manager.GetClient(ctx, seedAccount)
	if err != nil {
		return status.Errorf(codes.Internal, "failed to get client: %v", err)
	}

	if err := client.UnfollowBySubject(ctx, subject); err != nil {
		return status.Errorf(codes.Internal, "failed to unfollow: %v", err)
	}

	return nil
}

// Like likes a post on Bluesky.
func (s *Server) Like(ctx context.Context, seedAccount, subjectURI, subjectCID string) (*RecordRef, error) {
	if seedAccount == "" {
		return nil, status.Error(codes.InvalidArgument, "seed_account is required")
	}
	if subjectURI == "" {
		return nil, status.Error(codes.InvalidArgument, "subject_uri is required")
	}
	if subjectCID == "" {
		return nil, status.Error(codes.InvalidArgument, "subject_cid is required")
	}

	client, err := s.manager.GetClient(ctx, seedAccount)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get client: %v", err)
	}

	result, err := client.Like(ctx, subjectURI, subjectCID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to like: %v", err)
	}

	return &RecordRef{
		URI: result.URI,
		CID: result.CID,
	}, nil
}

// Unlike removes a like from a post.
func (s *Server) Unlike(ctx context.Context, seedAccount, uri string) error {
	if seedAccount == "" {
		return status.Error(codes.InvalidArgument, "seed_account is required")
	}
	if uri == "" {
		return status.Error(codes.InvalidArgument, "uri is required")
	}

	client, err := s.manager.GetClient(ctx, seedAccount)
	if err != nil {
		return status.Errorf(codes.Internal, "failed to get client: %v", err)
	}

	if err := client.Unlike(ctx, uri); err != nil {
		return status.Errorf(codes.Internal, "failed to unlike: %v", err)
	}

	return nil
}

// Repost reposts a post on Bluesky.
func (s *Server) Repost(ctx context.Context, seedAccount, subjectURI, subjectCID string) (*RecordRef, error) {
	if seedAccount == "" {
		return nil, status.Error(codes.InvalidArgument, "seed_account is required")
	}
	if subjectURI == "" {
		return nil, status.Error(codes.InvalidArgument, "subject_uri is required")
	}
	if subjectCID == "" {
		return nil, status.Error(codes.InvalidArgument, "subject_cid is required")
	}

	client, err := s.manager.GetClient(ctx, seedAccount)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get client: %v", err)
	}

	result, err := client.Repost(ctx, subjectURI, subjectCID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to repost: %v", err)
	}

	return &RecordRef{
		URI: result.URI,
		CID: result.CID,
	}, nil
}

// Unrepost removes a repost.
func (s *Server) Unrepost(ctx context.Context, seedAccount, uri string) error {
	if seedAccount == "" {
		return status.Error(codes.InvalidArgument, "seed_account is required")
	}
	if uri == "" {
		return status.Error(codes.InvalidArgument, "uri is required")
	}

	client, err := s.manager.GetClient(ctx, seedAccount)
	if err != nil {
		return status.Errorf(codes.Internal, "failed to get client: %v", err)
	}

	if err := client.Unrepost(ctx, uri); err != nil {
		return status.Errorf(codes.Internal, "failed to unrepost: %v", err)
	}

	return nil
}

// GetNotifications gets notifications for a connected account.
func (s *Server) GetNotifications(ctx context.Context, seedAccount string, limit int, cursor string) (*NotificationsResult, error) {
	if seedAccount == "" {
		return nil, status.Error(codes.InvalidArgument, "seed_account is required")
	}

	client, err := s.manager.GetClient(ctx, seedAccount)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get client: %v", err)
	}

	result, err := client.GetNotifications(ctx, limit, cursor)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get notifications: %v", err)
	}

	notifications := make([]*Notification, len(result.Notifications))
	for i, n := range result.Notifications {
		notifications[i] = notificationToProto(n)
	}

	return &NotificationsResult{
		Notifications: notifications,
		Cursor:        result.Cursor,
	}, nil
}

// GetManager returns the underlying manager for use by other services.
func (s *Server) GetManager() *atproto.Manager {
	return s.manager
}

// Helper types (these will be replaced by proto-generated types)

// ConnectionResult is the result of a connection operation.
type ConnectionResult struct {
	Status  *ConnectionStatus
	Profile *BlueskyProfile
}

// ConnectionStatus represents the status of a Bluesky connection.
type ConnectionStatus struct {
	SeedAccount string
	DID         string
	Handle      string
	IsConnected bool
	PDSURL      string
	ConnectTime time.Time
}

// BlueskyProfile represents a Bluesky profile.
type BlueskyProfile struct {
	DID             string
	Handle          string
	DisplayName     string
	Description     string
	Avatar          string
	Banner          string
	FollowersCount  int64
	FollowsCount    int64
	PostsCount      int64
	IndexedAt       time.Time
	ViewerFollowing bool
	ViewerFollowedBy bool
	ViewerBlocking  bool
	ViewerMuted     bool
}

// SearchActorsResult contains search results.
type SearchActorsResult struct {
	Actors []*BlueskyProfile
	Cursor string
}

// TimelineResult contains timeline results.
type TimelineResult struct {
	Feed   []*FeedItem
	Cursor string
}

// FeedItem represents a feed item.
type FeedItem struct {
	Post   *Post
	Reply  *ReplyContext
	Reason *FeedReason
}

// Post represents a Bluesky post.
type Post struct {
	URI              string
	CID              string
	Author           *BlueskyProfile
	Text             string
	CreatedAt        time.Time
	IndexedAt        time.Time
	ReplyCount       int64
	RepostCount      int64
	LikeCount        int64
	ViewerLiked      bool
	ViewerReposted   bool
	ViewerLikeURI    string
	ViewerRepostURI  string
}

// ReplyContext provides context for replies.
type ReplyContext struct {
	Root   *Post
	Parent *Post
}

// FeedReason explains why a post is in the feed.
type FeedReason struct {
	Type      string
	By        *BlueskyProfile
	IndexedAt time.Time
}

// ReplyRef references for replying to a post.
type ReplyRef struct {
	RootURI   string
	RootCID   string
	ParentURI string
	ParentCID string
}

// RecordRef is a reference to a created record.
type RecordRef struct {
	URI string
	CID string
}

// NotificationsResult contains notifications.
type NotificationsResult struct {
	Notifications []*Notification
	Cursor        string
}

// Notification represents a notification.
type Notification struct {
	URI       string
	CID       string
	Author    *BlueskyProfile
	Reason    string
	Record    interface{}
	IsRead    bool
	IndexedAt time.Time
}

// Conversion functions

func connectionToStatus(conn *atproto.Connection) *ConnectionStatus {
	if conn == nil {
		return nil
	}
	return &ConnectionStatus{
		SeedAccount: conn.SeedAccount,
		DID:         conn.DID,
		Handle:      conn.Handle,
		IsConnected: true,
		PDSURL:      conn.PDSURL,
		ConnectTime: conn.ConnectTime,
	}
}

func profileToProto(p *atproto.Profile) *BlueskyProfile {
	if p == nil {
		return nil
	}
	result := &BlueskyProfile{
		DID:            p.DID,
		Handle:         p.Handle,
		DisplayName:    p.DisplayName,
		Description:    p.Description,
		Avatar:         p.Avatar,
		Banner:         p.Banner,
		FollowersCount: p.FollowersCount,
		FollowsCount:   p.FollowsCount,
		PostsCount:     p.PostsCount,
		IndexedAt:      p.IndexedAt,
	}
	if p.Viewer != nil {
		result.ViewerFollowing = p.Viewer.Following != ""
		result.ViewerFollowedBy = p.Viewer.FollowedBy != ""
		result.ViewerBlocking = p.Viewer.Blocking != ""
		result.ViewerMuted = p.Viewer.Muted
	}
	return result
}

func profileBasicToProto(p *atproto.ProfileBasic) *BlueskyProfile {
	if p == nil {
		return nil
	}
	result := &BlueskyProfile{
		DID:         p.DID,
		Handle:      p.Handle,
		DisplayName: p.DisplayName,
		Avatar:      p.Avatar,
	}
	if p.Viewer != nil {
		result.ViewerFollowing = p.Viewer.Following != ""
		result.ViewerFollowedBy = p.Viewer.FollowedBy != ""
		result.ViewerBlocking = p.Viewer.Blocking != ""
		result.ViewerMuted = p.Viewer.Muted
	}
	return result
}

func feedItemToProto(item *atproto.FeedItem) *FeedItem {
	if item == nil {
		return nil
	}
	result := &FeedItem{
		Post: postToProto(item.Post),
	}
	if item.Reply != nil {
		result.Reply = &ReplyContext{
			Root:   postToProto(item.Reply.Root),
			Parent: postToProto(item.Reply.Parent),
		}
	}
	if item.Reason != nil {
		result.Reason = &FeedReason{
			Type:      item.Reason.Type,
			By:        profileBasicToProto(item.Reason.By),
			IndexedAt: item.Reason.IndexedAt,
		}
	}
	return result
}

func postToProto(p *atproto.Post) *Post {
	if p == nil {
		return nil
	}
	result := &Post{
		URI:         p.URI,
		CID:         p.CID,
		Author:      profileBasicToProto(p.Author),
		IndexedAt:   p.IndexedAt,
		ReplyCount:  p.ReplyCount,
		RepostCount: p.RepostCount,
		LikeCount:   p.LikeCount,
	}
	if p.Record != nil {
		result.Text = p.Record.Text
		result.CreatedAt = p.Record.CreatedAt
	}
	if p.Viewer != nil {
		result.ViewerLiked = p.Viewer.Like != ""
		result.ViewerReposted = p.Viewer.Repost != ""
		result.ViewerLikeURI = p.Viewer.Like
		result.ViewerRepostURI = p.Viewer.Repost
	}
	return result
}

func notificationToProto(n *atproto.Notification) *Notification {
	if n == nil {
		return nil
	}
	return &Notification{
		URI:       n.URI,
		CID:       n.CID,
		Author:    profileBasicToProto(n.Author),
		Reason:    n.Reason,
		Record:    n.Record,
		IsRead:    n.IsRead,
		IndexedAt: n.IndexedAt,
	}
}

var _ = fmt.Errorf // Silence unused import
