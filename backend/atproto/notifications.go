package atproto

import (
	"context"
	"fmt"
	"net/url"
	"time"
)

// Notification represents a notification.
type Notification struct {
	URI           string        `json:"uri"`
	CID           string        `json:"cid"`
	Author        *ProfileBasic `json:"author"`
	Reason        string        `json:"reason"` // like, repost, follow, mention, reply, quote
	ReasonSubject string        `json:"reasonSubject,omitempty"`
	Record        any           `json:"record,omitempty"`
	IsRead        bool          `json:"isRead"`
	IndexedAt     time.Time     `json:"indexedAt"`
}

// NotificationsResult contains notifications.
type NotificationsResult struct {
	Notifications []*Notification `json:"notifications"`
	Cursor        string          `json:"cursor,omitempty"`
	SeenAt        *time.Time      `json:"seenAt,omitempty"`
}

// GetNotifications gets the authenticated user's notifications.
func (c *Client) GetNotifications(ctx context.Context, limit int, cursor string) (*NotificationsResult, error) {
	params := url.Values{}
	if limit > 0 {
		params.Set("limit", fmt.Sprintf("%d", limit))
	}
	if cursor != "" {
		params.Set("cursor", cursor)
	}

	var result NotificationsResult
	err := c.xrpcCall(ctx, "GET", "app.bsky.notification.listNotifications", params, nil, &result)
	if err != nil {
		return nil, fmt.Errorf("get notifications: %w", err)
	}

	return &result, nil
}

// GetUnreadCount gets the count of unread notifications.
func (c *Client) GetUnreadCount(ctx context.Context) (int64, error) {
	var result struct {
		Count int64 `json:"count"`
	}

	err := c.xrpcCall(ctx, "GET", "app.bsky.notification.getUnreadCount", nil, nil, &result)
	if err != nil {
		return 0, fmt.Errorf("get unread count: %w", err)
	}

	return result.Count, nil
}

// UpdateSeen marks notifications as seen up to a given time.
func (c *Client) UpdateSeen(ctx context.Context, seenAt time.Time) error {
	body := map[string]string{
		"seenAt": seenAt.UTC().Format(time.RFC3339Nano),
	}

	err := c.xrpcCall(ctx, "POST", "app.bsky.notification.updateSeen", nil, body, nil)
	if err != nil {
		return fmt.Errorf("update seen: %w", err)
	}

	return nil
}
