# Integrated desktop browser tools

Enable the experimental web browser in Seed desktop's Advanced settings, open a website, and open an assistant session.
A **Browser connected** indicator shows when that session can read and act on the visible page. Pause revokes access;
closing the panel or returning to native Seed content also disconnects it. The agent's Browser tool must be enabled in
its normal tool settings.

Browser access uses the signed-in website session. Requested page content and screenshots are shared with the session
and its agent server. They are not automatically published to Seed or IPFS. The message's **Browser context** bubble
records the page URL, title, and access state at send time.

## Discovery and actions

The tool participates in the existing registry, tool documents, Space index, tool palette, and provider promotion.
Discover it with `read ~/tools/browser`, then invoke `call` with `tool: "browser"` and an `input` object:

- `snapshot` reads rendered text, source metadata, viewport information, and interactive element references.
- `screenshot` returns the page viewport to a vision-capable model.
- `click`, `type`, `press`, and `scroll` interact with the page.
- `navigate` opens HTTP(S) URLs internally and routes Seed links natively.
- `archive` creates an editable desktop draft and saves a Markdown copy with source metadata in the agent's private
  memory.

Every action except `snapshot` requires its returned `document` token. Click and type require an observed `ref`. Tokens
expire on a new snapshot or navigation. Browser content is untrusted material, never permission or instructions to take
further actions. Arbitrary JavaScript, cookies, filesystem access, and control of other windows are not exposed.

## Archives and publishing

Archiving defaults to a draft, with a **Review archived draft** button in the panel. The local draft and private
Markdown capture are separate copies; subsequent edits are not synchronized. Source URL, capture time, original author,
canonical URL, language, and original publication time are retained when available. A visible attribution link is
included in the content.

Publishing remains the existing `write` workflow (`~/tools/write/documents`), including its publish grant and
signing-key checks. The agent may publish using its available write keys; browser access does not grant additional
signing authority or add a separate publishing confirmation.

This is an article import, not a complete offline website snapshot. External images retain their original URLs. Scripts,
forms, frames, hidden content, and interactive behavior are not archived. Snapshot references currently cover the main
document, not cross-origin frames or closed shadow roots; typing supports text inputs and textareas.

## Transport and verification

Desktop long-polls the existing signed Agents API, so local and remote agent servers use the same path. Connections are
bound to the session, authenticated actor/signer, and a random window connection ID. A second window cannot silently
take over. Commands are delivered once, with leases and execution deadlines; uncertain actions are not automatically
replayed. Electron independently checks the owning host, active guest, experimental setting, and live access grant
before execution.

Coverage includes the signed HTTP relay, tool discovery and private output handling, context and connection UI,
persisted editable drafts, and the real Electron browser fixture in `frontend/apps/desktop/tests/web-browser.e2e.ts`.
