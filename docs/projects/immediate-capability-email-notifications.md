# Immediate Capability Grant Email Notifications

## Problem

When a site owner grants writer access to another account, the recipient may not know they can now contribute unless
they open the app or inspect the site collaborators list.

This matters more with the new “Add as writer” action because it behaves like an invitation. The recipient should
receive a timely email telling them they were granted access and where to go next.

## Solution

Add immediate email notifications for new `Capability` blob events.

Assumptions:

- Send only to accounts with a verified notification email configured in the notify service.
- Respect unsubscribe and disabled-email state.
- Treat this as an immediate notification, like mentions and replies.
- First version sends email only for meaningful write access grants, especially `WRITER`.
- Do not send an email to the issuer if they grant a capability to themselves.
- Resolve delegate or alias accounts to the canonical root account before selecting the recipient.

User stories:

- As a newly promoted site member, I receive an email soon after someone grants me writer access.
- As a site owner, I can click “Add as writer” and trust that the recipient will be notified.
- As a user who disabled or did not verify email notifications, I do not receive capability emails.

Implementation plan:

- Extend the notify service event evaluator in `frontend/apps/notify/app/email-notifier.ts`.

  - Today it handles `newCitation` and `newBlob` events for `Ref` and `Comment`.
  - Add handling for `newBlob` events where `blob.blobType === 'Capability'`.
  - Load the capability with `grpcClient.accessControl.getCapability` using the event identity available on the blob
    event.
  - Resolve delegate account metadata, issuer/account metadata, and target site/document metadata.
  - Find the notification subscription whose account ID matches the canonical capability delegate.
  - Skip if no verified email config exists.
  - Skip unsupported capability roles unless they are explicitly included.

- Add a new notification reason: `capability-granted`.

  - Delivery kind: `immediate`.

- Add a new email template in `frontend/apps/emails/notifier.tsx`.

  - Suggested subject: `You can now write on <site/document name>`.
  - Body should include who granted access when available, what role was granted, what site or document it applies to, a
    CTA to open the site/document, and notification management/unsubscribe links.

- Decide whether capability grants should appear in the in-app notification inbox.

  - Recommended: yes, if adding the new reason is low-cost.
  - If inbox support expands scope too much, keep V1 email-only and do not persist this notification reason.

- Add tests.
  - Notify routing maps `capability-granted` to `immediate`.
  - A capability event creates a queued notification for the delegate.
  - No email is queued without verified config.
  - No email is queued for self-grants.
  - The email template renders subject, CTA, and unsubscribe/manage link.
  - Existing mention/reply/comment notifications continue to work.

## Scope

Estimated implementation: 1–2 days.

Phase 1: Event handling and routing, half day.

- Add `Capability` event detection.
- Load capability details.
- Resolve delegate and target account metadata.
- Route to the delegate subscription.

Phase 2: Email template, half day.

- Add `createCapabilityGrantedEmail`.
- Add subject/text/html rendering tests.
- Wire the template into the immediate email sender.

Phase 3: Tests and hardening, half to one day.

- Add notifier tests for capability events.
- Add routing tests.
- Verify unsubscribe behavior and verified-email gating.
- Run notify package tests and frontend typecheck.

Dependencies:

- Activity feed must emit `newBlob` events for `Capability` blobs.
- Notify service must be able to fetch capability details by event ID/CID.
- Recipient must already have notification email configured and verified.

## Rabbit Holes

- Building a full invitation system with accept/decline flows.
- Adding a new notification preference category UI.
- Supporting demotion or removal emails.
- Sending emails to people who have no verified notification email on file.
- Guaranteeing real-time delivery from the write path instead of using the existing notify polling loop.
- Reworking the notification inbox schema beyond adding the new reason.
- Designing per-site email notification preferences.

## No Gos

- Do not send capability emails to unverified email addresses.
- Do not bypass unsubscribe or notification config state.
- Do not send historical backfill emails for old capability events.
- Do not block capability creation on email delivery.
- Do not make the frontend “Add as writer” mutation call an email API directly.
- Do not send duplicate emails for duplicate/delegate capability rows that resolve to the same canonical account.
