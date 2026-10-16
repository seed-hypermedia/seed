@manual @production @creates-public-data
Feature: A new web user publishes a space on a free hyper.media subdomain
  Exercise the production UI with a new identity and no existing browser session.
  This is a manual acceptance test specification, not a registered Vitest suite.
  Use a fresh email or alias controlled by the tester and a unique subdomain.
  Preserve the test identity's recovery information outside this repository.

  Background:
    Given all previous private windows have been closed
    And I open a new incognito or private browser window
    And I visit "https://seed.hyper.media"
    Then the "Join" button should be visible

  Scenario: Create a new identity, create a space, and publish its public address
    When I click "Join"
    And I click "Create identity in Hypermedia"
    Then I should reach "https://hyper.media/vault"
    And I should see "What's your email?"
    When the tester accepts the displayed Terms and Privacy Policy
    And I enter the new test email and click "Send code"
    And I enter the verification code received by that email
    And I complete new-account setup and the requested identity delegation
    Then I should return to Seed with the new identity signed in
    When I open "https://seed.hyper.media"
    And I click "Create your knowledge base"
    And I fill "Space name" with a unique "Codex Publishing Test" name
    And I click "Continue"
    And I click "Skip for now"
    And I click "Create space"
    Then I should see my space name in the draft editor
    When I enter a unique test sentence in the document body
    And I click "Publish"
    And I click "Publish: Make it live now"
    Then the home document should be published under my identity
    And reloading the page should preserve its name and test sentence
    When I open the space's "Web Domain" settings
    And I choose "Publish to Web Domain"
    And I choose "Free hyper.media domain"
    And I complete Seed Hosting sign-in if requested
    And I enter an available unique subdomain in "Subdomain"
    And I click "Publish Space"
    Then publication should finish without an error
    And the resulting address should be "https://<chosen-subdomain>.hyper.media"
    And reopening "Web Domain" settings should show that same address
    When I open that address in a separate browser context with no cookies or identity
    Then HTTPS should load without a certificate warning
    And the page should show the exact space name and test sentence
    And the page should be readable without signing in
    And reloading should preserve the published content

  Scenario: A logged-out draft requires identity creation before publication
    When I click "Create your knowledge base"
    And I fill "Space name" with a unique "Codex Publishing Test" name
    And I click "Continue"
    And I click "Skip for now"
    And I click "Create space"
    And I enter a unique test sentence in the document body
    And I click "Publish"
    And I click "Publish: Make it live now"
    Then the "Join Seed Hypermedia" dialog should appear
    And "Create identity in Hypermedia" should be available
    When I complete new identity signup and return
    Then the draft name and body should be preserved
    And I should be able to continue the publication scenario above

  Scenario: Vault hosting rejection offers a usable fallback
    Given I completed email-verified identity signup in the private window
    And my new space home document has been published
    When I click "Publish to a Domain"
    And I choose "Free hyper.media domain"
    And the automatic vault hosting login returns "Email validation required."
    Then "Signing in…" should stop
    And I should see the hosting email-code login form or an actionable error
    And I should be able to continue without closing or reloading the page

  @desktop @revokes-test-session
  Scenario: A rejected saved hosting session must prompt reauthentication
    Given I use the production desktop app with a disposable test identity
    And I have signed in to production Seed Hosting with the test email
    And "GET https://host.seed.hyper.media/api/account" accepts that session
    And I create and publish a new test space home document
    When the test harness posts "{}" to "https://host.seed.hyper.media/api/auth/logout"
    # Authenticate this setup request with ONLY the disposable test session token.
    # Verify /api/account belongs to the exact test email before revoking it.
    # Keep the app running and do not clear its local hosting state.
    And I click "Publish to a Domain"
    And I choose "Free hyper.media domain"
    And I enter an available unique subdomain
    And I click "Publish Space"
    Then the production hosting API rejects the saved session with HTTP 401
    And the app should explain that the hosting session is no longer valid
    And the app should offer hosting sign-in instead of silently remaining logged in
    When I sign in again with a fresh email code
    And I retry the same subdomain for the same space
    Then publication should succeed

  # Manual run: 2026-10-16, Starlight, Brave Private window.
  # PASS: logged-out production home, anonymous space wizard, local draft, auth gate.
  # PASS: new email alias, accepted terms, email verification, account/recovery setup.
  # PASS: returning from signup preserved the draft and published the home document.
  # Web space: https://seed.hyper.media/hm/z6MkrtbVoEEnSoLCbBfsGuF5pr2dzLkBjU3Y88a6boR9HbfB
  # FAIL: Publish to a Domain -> Free hyper.media domain remains on "Signing in…".
  # Console: Error: Email validation required. at host.ts:379:13 (mutation.mjs:158).
  # Reproduced twice by Back -> Free hyper.media domain; remained stuck for minutes.
  # No email fallback or actionable error appears; no web subdomain was registered.
  # Screenshot: /tmp/seed-publishing-repro/web-hosting-stuck.png
  #
  # Desktop comparison: Seed 2026.10.5 (e2690b94), installed /Applications/Seed.app.
  # PASS: account menu -> Create account -> Create my Space -> wizard -> Publish.
  # Identity/space name: Codex Desktop Publish Test 2026-10-16.
  # Space: hm://z6Mkga38TbVQsenLVDrWBYY5AEq2EPhGKJh4QpEpdgX2sdMc
  # PASS: Publish to a Domain -> Free hyper.media domain -> fresh email-code login.
  # PASS: Choose Your Subdomain -> codex-publish-20261016-k7m4 -> Publish Space.
  # PASS: "Published to the Web!" and private browser readback/reload with "Join" visible.
  # Public URL: https://codex-publish-20261016-k7m4.hyper.media
  # Exact body: Desktop production publishing reproduction test, created 2026-10-16.
  # Fresh desktop login did not reproduce Gabo's 401; stale-session test below does.
  # These are observations of the installed production app, not automated test results.

  # Follow-up 2026-10-16: matched Gabo's desktop failure using a real revoked session.
  # Production: /api/account returned 200 for the exact disposable test email.
  # Setup: /api/auth/logout returned 200 {"success":true}; no local state was edited.
  # Control: GET /api/sites with that saved token returned 401 {"error":"Invalid authorization"}.
  # Desktop identity/space: Codex Stale Session Test.
  # Space: hm://z6Mkt2rELzSHXiP4YYMpCQFrxFAW3wLiCxbsYkwsCDHZA7W3
  # FAIL: UI still showed Choose Your Subdomain and Logged in to host.seed.hyper.media.
  # Two Publish Space clicks generated POST https://host.seed.hyper.media/api/sites
  # 401 (Unauthorized), while the dialog showed no error and retained the login claim.
  # Attempted subdomain: codex-stale-20261016-k7m4.
  # Evidence: /tmp/seed-publishing-repro/desktop-stale-session-401.png
  # Cause in client source: loggedIn checks only token presence (models/host.ts:382);
  # non-OK requests read respJson.message (line 146), but auth middleware sends error.
  # publish-site.tsx:347 renders error.message, so the server's reason is lost.
  # This reproduces the reported symptom; it does not prove why Gabo's token was rejected.
  # PASS recovery: Log out -> email-code sign-in -> same subdomain/space -> Published to the Web!
  # Public readback showed Join and the exact test content at:
  # https://codex-stale-20261016-k7m4.hyper.media
  # Recovery screenshot: /tmp/seed-publishing-repro/desktop-recovered-public.png
  # Hosting session is valid again after the test; no other accounts/sessions were revoked.

  # Fix verification, 2026-10-16 (source checkout, not yet released):
  # Desktop hostAPI now surfaces both error/message responses and expires a rejected token.
  # Publishing offers email-code sign-in, retains the email and chosen subdomain, then resumes.
  # Regression suites cover the HTTP response, persisted session, login UI, and late-response races.
  # The separate production web vault-login fallback failure above remains open.
