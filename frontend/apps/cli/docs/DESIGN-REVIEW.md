# CLI Design Review: Current State vs Design Principles

Audit of the current CLI implementation against the
[CLI Design Principles](https://seedteamtalks.hyper.media/human-interface-library/cli-design-principles).

Source: `hm://z6MkuBbsB1HbSNXLvJCRCrPhimY6g7tzhr4qvcYKPuSZzhno/human-interface-library/cli-design-principles`

---

## 1. Self Documenting

> "The command line interface should teach you how to use it. For both agents and
> humans, you can start using the CLI before you know how to use it. When you run
> `seed` without any arguments, or when you are missing some arguments, it should
> explain what you can do from this area of the CLI."

### Gaps

- **Command name is `seed-cli`, not `seed`.** The principles doc says the command
  is `seed`. The package.json registers `seed-cli` and `seed-hypermedia`. Neither
  is `seed`.

- **Running with no args exits with code 1 and prints help twice.** The help text
  prints double (bug). And it exits with an error code, but "no args = show help"
  shouldn't be an error — it should exit 0. The user is *learning*, not failing.

- **`document create` with missing `--title` says `required option '--title
  <title>' not specified` — but doesn't show what a valid command looks like.**
  Better: show a full usage example alongside the error.

- **Subcommand groups don't self-describe well.** Running `seed-cli document`
  with no subcommand shows nothing (no output). It should show the available
  document subcommands with examples.

- **No contextual examples in help text.** Only `capability` and `contact`
  commands use `.addHelpText('after', ...)` to show examples. All other command
  groups lack inline examples. Every subcommand group should show examples.

- **No "did you mean?" suggestions.** If you typo a command, you get
  `error: unknown command 'documnet'` with no suggestions.

---

## 2. Simple

> "We should avoid any complexity that we possibly can. For example, if the user
> types `seed hm://...` then we can infer that the user is trying to read that
> URL or at least get metadata about it."

### Gaps

- **`seed-cli hm://...` doesn't work.** Currently produces
  `error: unknown command 'hm://...'`. The principles say this should be a valid
  shorthand for reading/fetching that URL. This is a major UX gap — the most
  intuitive thing a user would try doesn't work.

- **Bare UID doesn't work as a top-level argument either.** `seed-cli z6Mk...`
  also fails. Should infer "get this account/document."

- **No URL inference.** The CLI doesn't detect when an argument looks like an HM
  URL and route accordingly. The first positional arg should be checked: if it
  starts with `hm://` or `z6Mk`, treat it as `document get <url>`.

- **Command structure is overly nested for common operations.** `document get`,
  `document create`, `document update` — the most common operations require two
  words. The principles suggest `seed hm://DOC_URL` should just work for reading.
  For writing, `seed hm://DOC_URL add-comment -m "text"` should also work (see
  Flexible section).

- **The `--blocks` / `--blocks-file` options add complexity.** Most users (human
  and agent) will use Markdown. The JSON block format is an advanced escape hatch.
  Consider whether these need to be in the top-level create command or could be a
  separate advanced subcommand.

---

## 3. Flexible

> "The user may attempt to do one thing in many ways, and we should support as
> many of them as possible. For example if the user is trying to create a comment,
> both of these workflows should be considered valid:
> `seed hm://DOC_URL add-comment -m 'My Comment Text'` AND
> `seed create comment -m='My Comment Text' -target='hm://DOC_URL'`"

### Gaps

- **Only one way to do each thing.** Currently the CLI is rigid:
  - Creating a comment: only `comment create <targetId> --body "text" --key name`
  - No shorthand like `seed hm://DOC add-comment -m "text"`
  - No URL-first workflow where you start from a document and then act on it

- **No action inference from context.** The principles suggest a URL-first UX
  where you specify a target, then an action. The current CLI only supports
  action-first (verb noun) patterns.

- **No `-m` shorthand for message/body.** The principles use `-m` for message
  text. The current CLI uses `--body` (long form only, no short flag). `-m` is a
  much more natural flag for both comments and inline document content.

- **No `=` syntax for options.** The principles example shows `-m="text"` and
  `-target="url"`. Commander.js supports this but it's not explicitly tested or
  documented.

- **No pipe/stdin support.** Can't do
  `echo "my content" | seed-cli document create z6Mk... --title "From Pipe"`.
  Should support reading body from stdin when no `--body` or `--body-file` is
  provided.

---

## 4. Markdown First

> "Humans and Agents both like to read markdown. Which is more readable than our
> raw JSON format. The CLI can provide front matter to display metadata. By
> default the CLI will provide documentation **and** content. But when the `-q`
> flag is provided, the documentation/info will be excluded, and it will only
> provide MD+frontmatter. We will also support JSON workflows, with the
> `--json` flag."

### Gaps

- **Default output is JSON, not Markdown.** This is the opposite of what the
  principles say. The principles say the *default* should be Markdown (with
  documentation), and `--json` should be the opt-in format. Currently Markdown
  requires the explicit `--md` flag.

- **`-q` behavior doesn't match the spec.** The principles say `-q` should give
  MD+frontmatter *without* the documentation/info. Currently `-q` gives bare
  tab-separated values (just IDs and names). This is useful for scripting but
  doesn't match the described design.

- **No "documentation" mode.** The principles describe a default mode that
  includes both documentation (how to use the CLI in this context) AND content.
  For example, when you read a document, the output might include hints like
  "To edit this document, run: seed document update ...". This doesn't exist at
  all.

- **Frontmatter is opt-in, not default.** The principles say MD+frontmatter is
  the quiet mode. Currently frontmatter requires `--frontmatter` flag on top of
  `--md`.

---

## 5. Compatible Workflows

> "Match the workflows of the Desktop app. For example: when creating new
> Documents, we should edit the parent Doc and add a card embed."

### Gaps

- **`document create` doesn't add a card embed to the parent.** The CLI creates
  the document but does NOT modify the parent document to include an embed/link
  to the new child. The desktop app does this automatically. This means documents
  created via CLI are "orphans" — they exist at a path but aren't linked from
  their parent's content.

- **No "add child document" workflow.** Desktop has "Add sub-document" which
  creates the doc AND adds a card embed to the parent in one step. The CLI has no
  equivalent.

- **Comment creation doesn't mirror desktop threading UX.** The desktop shows a
  rich discussion thread UI. The CLI `comment discussions` command exists for
  reading, but the creation workflow doesn't surface thread context (like showing
  existing comments before adding a new one).

- **No equivalent of desktop's "suggested actions."** When viewing a document in
  the desktop app, you get contextual actions (edit, comment, share). The CLI
  output gives no hints about what you can do next.

---

## 6. Cautious Workflows

> "We should have a confirmation step before signing. If you attempt to write
> data without a `-y` flag, then it is considered a 'dry run'. Then you must
> re-run with `-y` to confirm the signing and publishing. We should also have
> draft states for documents and comments."

### Gaps

- **No dry-run / confirmation step.** This is completely missing. Every write
  command (`document create`, `document update`, `document delete`,
  `comment create`, etc.) immediately signs and publishes. There is no `-y` flag,
  no preview, no confirmation.

- **No draft state.** There is no concept of local drafts. Every change is
  immediately published to the network and becomes part of the permanent history.
  The [Draft Dispute](https://seedteamtalks.hyper.media/human-interface-library/cli-design-principles/draft-dispute)
  discussion acknowledges this is debated, but the principles doc says drafts
  should exist.

- **No preview before publish.** Can't see what a `document create` or
  `document update` would produce before it goes live. Would be useful to show
  the resulting Markdown/blocks and say "This will be published. Run with -y to
  confirm."

- **Destructive operations have minimal safety.**
  - `document delete` immediately publishes a tombstone with no confirmation
    (only `key remove` requires `--force`).
  - `document move` immediately redirects with no undo.
  - `comment delete` immediately tombstones.

- **No undo / rollback.** Once published, there's no CLI command to revert a
  change (e.g., roll back to a previous version).

---

## 7. Compliant Workflows

> "Follow conventions around stdout/stderr. Error codes. We should also follow
> certain CLI conventions such as `-h` and `-q` and `-y`. The CLI should be
> non-interactive."

### Gaps

- **`-y` flag doesn't exist.** The principles specifically call out `-y` as a
  convention. It's not implemented.

- **Exit codes are only 0 or 1.** No differentiation between "not found"
  (could be exit 2), "auth error" (exit 3), "network error" (exit 4), etc. More
  granular exit codes help scripting.

- **Success messages go to stdout, not stderr.** The `printSuccess`, `printInfo`
  messages (like `✓ Document created`) go to stdout via `console.log`. Per UNIX
  convention, only data output should go to stdout; informational/progress
  messages should go to stderr. This breaks piping —
  `seed-cli document create ... | jq` would include the `✓` line in the JSON.

- **Mixed stdout/stderr.** `printError` correctly uses `console.error` (stderr),
  but `printSuccess` and `printInfo` use `console.log` (stdout). Inconsistent.

- **Help text exits with code 1.** Running `seed-cli` with no args exits 1.
  Showing help shouldn't be an error.

---

## 8. Additional Gaps

Missing features visible from comparing the CLI to the design doc's vision and
the desktop app:

- **No account creation.** The CLI can generate keys but can't
  create/register an account on a server. The desktop app can. The signing.ts
  has genesis change creation but there's no `account create` command.

- **No media/file upload.** Can't attach images, files, or media to documents.
  The desktop app supports this.

- **No site management.** Can't set site URL, configure site settings, or manage
  site-level metadata.

- **No subscription/follow.** Can't subscribe to accounts or documents for
  updates.

- **No networking commands exposed.** The gRPC API has `Networking`, `P2P`,
  `Syncing` services but the CLI doesn't expose them.

- **No daemon management.** Can't start/stop/status the daemon from the CLI.

- **No batch operations.** Can't create multiple documents, comments, or contacts
  in one command.

- **No template/scaffold support.** Can't create a document from a template.

---

## Summary: Priority Improvements

### Critical (violates core principles)

| # | Improvement | Principle |
|---|-------------|-----------|
| 1 | `seed hm://...` should work — smart URL inference | Simple |
| 2 | Default output should be Markdown, not JSON | Markdown First |
| 3 | Add dry-run / `-y` confirmation for all writes | Cautious Workflows |
| 4 | Move `printSuccess`/`printInfo` to stderr | Compliant Workflows |
| 5 | Command name should be `seed` | Self Documenting |

### High priority

| # | Improvement | Principle |
|---|-------------|-----------|
| 6 | Add local draft state for documents and comments | Cautious Workflows |
| 7 | `document create` should auto-embed in parent doc | Compatible Workflows |
| 8 | Add inline examples to all command help text | Self Documenting |
| 9 | Add `-m` flag as shorthand for `--body` | Flexible |
| 10 | Fix double-printed help + exit code 0 for no-args | Self Documenting / Compliant |

### Medium priority

| # | Improvement | Principle |
|---|-------------|-----------|
| 11 | URL-first workflow (`seed hm://DOC add-comment -m "text"`) | Flexible |
| 12 | Stdin support for body content | Flexible |
| 13 | Contextual "next actions" hints in output | Self Documenting / Compatible |
| 14 | More granular exit codes (not-found, auth, network) | Compliant Workflows |
| 15 | Account creation command | Compatible Workflows |
| 16 | Media/file upload support | Compatible Workflows |
