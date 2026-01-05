# Seed Hypermedia Documentation

Technical documentation for the Seed Hypermedia codebase.

## Contents

### Core Systems

- [API System](./api-system.md) - Type-safe API architecture shared between web and desktop
- [gRPC Client](./grpc-client.md) - Backend communication layer and service reference
- [Activity Feed](./activity-feed.md) - Event streaming and activity tracking

### Services

- [Notify Service](./notify-service.md) - Email notification system

## Quick Reference

### Key Files

| Component | Location |
|-----------|----------|
| API Router | `@shm/shared/src/api.ts` |
| API Types | `@shm/shared/src/hm-types.ts` |
| gRPC Client | `@shm/shared/src/grpc-client.ts` |
| Activity Service | `@shm/shared/src/models/activity-service.ts` |
| Web API Route | `frontend/apps/web/app/routes/api.$.tsx` |
| Email Notifier | `frontend/apps/notify/app/email-notifier.ts` |
| Email Templates | `frontend/apps/emails/notifier.tsx` |

### API Endpoints

| Endpoint | Description |
|----------|-------------|
| `Resource` | Fetch document/comment by ID |
| `Account` | Account metadata |
| `Comment` | Single comment by CID |
| `Search` | Full-text search |
| `Query` | Directory queries |
| `ListEvents` | Activity feed |
| `ListComments` | Comments on document |
| `ListCitations` | Entity mentions |
| `InteractionSummary` | Aggregated interaction counts |

See [API System](./api-system.md) for full endpoint reference.

### Notification Types

| Type | Trigger | Immediate |
|------|---------|-----------|
| `mention` | @mentioned in doc/comment | Yes |
| `reply` | Reply to your comment | Yes |
| `site-new-discussion` | New comment thread on your doc | Batched |

See [Notify Service](./notify-service.md) for implementation details.

## Development

### Common Commands

```bash
# Build types before development
yarn workspace @shm/shared build:types

# Run web app
yarn web

# Run desktop app
./dev run-desktop

# Run tests
yarn test
yarn web:test run <testName>
```

### Environment Variables

```bash
# Daemon connection
DAEMON_HTTP_URL=http://localhost:56001

# Site URL for notification links
SITE_BASE_URL=https://seedhypermedia.com

# SMTP for notifications
NOTIFY_SMTP_HOST=smtp.example.com
NOTIFY_SMTP_USER=user@example.com
NOTIFY_SMTP_PASSWORD=secret
```

## Contributing

When adding new features:

1. **New API Endpoint**: Follow steps in [API System - Adding New Endpoints](./api-system.md#adding-a-new-api-endpoint)
2. **New Notification Type**: Follow steps in [Notify Service - Adding New Types](./notify-service.md#adding-new-notification-types)
3. **gRPC Service Changes**: Update proto files in `backend/genproto/` and regenerate types
