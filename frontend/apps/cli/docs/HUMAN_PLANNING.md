# Approach Plan

- Design Philosophy - "DONE"
- TS SDK - Done with regard to App code migration
- Patterns - Started!
- Specific CLI Docs
- Tests
- Implementation
- Human Testing Document

# Patterns

- We should aggressively validate- no broken references or invalid data allowed (to the best of our ability)
- When reference a resource, we should be able to provide a hm:// or an https:// ID
  - it should automatically resolve to `hm://` under the hood
- When we reference an account, we should be able to provide a raw account ID or a hm:// URL (paths should be an error,
  but hm://ACCOUNT_ID/:profile is)
- Allow the user to reference an account by name (throw an error if there are two accounts with the same name, with
  useful info about the conflicting IDs)
- All output reprensentations should also be accepted as inputs (perhaps with the correct flags)
  - Default (MD)
  - JSON
  - HTML
- Most of these content features are built into `@seed-hypermedia/client` (TS/NPM library), and used by the CLI, so the
  CLI remains simple and other applications can utilize our functionality.
- Don't actually write by default. Dry run by default.
  - Include `-y` for explicit sign+publish
  - Environment variable `env.DANGEROUSLY_AUTO_ACCEPT` will always do the `-y` behavior
  - Dry run validates the action/command and explains that you have to re-run with `-y`
- Drafts: See notes below
- One-shot doc publishing: provide a list of operations
- `-q` will output only STDOUT (for status code 0), never output help text
  - Errors will still go to STDERR
- Certain formats like `--json` `--html` and `--md` (even though MD is default) as a unified way to request output type
  - Similar conventions for input types (as long as input flags are consistent with eachother)
- `seed <URL>` should auto get and give you a context in that resource. Plus docs about that context in the CLI
  - Inline workflow: `seed <CONTACT_URL> delete`
  - Absolute support: `seed contacts delete <CONTACT_URL>`

## Reading Convenience features

This `seed comment get <COMMENT_ID>` by default gives me markdown. Same goes for reading documents. These default
reading interfaces should give us conveniences so we dont have to make follow-up requests.

- When reading (default/markdown), whenever an account ID is shown it should also show the name (and the domain)
- When reading a doc with a mention, the mention should be resolved to `[@NAME](HTTPS_URL)`
- When reading an embed, actually resolve the embedded content (including version and BlockRef)

## Random Notes

- 3 types of blockRef

  - BlockID
  - BlockID+
  - BlockID:rangeStart:rangeEnd

- If you provide `--verbose` it deeply annotates the markdown:

An example verbose thing:

An image block has an optional width attribute. We don't want that info to be lost. There ARE ways (ugly) to encode this
info.

```
Default image representation:
![IMAGE_URL](Image Alt Text)

With verbose:
<img data-width="123" src="IMAGE_URL" alt="ALT TEXT" id="blockID" />

<!-- IMAGE_BLOC_ATTRS { with: 123 }  -->
<span data-type="ImageBlock" id="blockID" data-width="123">
![IMAGE_URL](Image Alt Text)
</span>

```

- A `--html` would be super useful and its also automatically verbose.

```html
<span id="Block1+">
<h2 id="Block1">Heading Block<h2>
<p id="Block2">Child of the heading</p>
</span>
```

A full Document when --html, should include metadata in the head

```html
<html>
  <head>
    <title>asdf</title>
    <meta name="site_layout" value="" />
  </head>
  <body>
    <!-- etc -->
  </body>
</html>
```

- When reading JSON, skip these "reading convenience" features

## Draft Workflow Brainstorm

```
> seed document <DOC_ID> edit
Draft created <DRAFT_ID>
DRAFT_FEATURES_EXPLAINER_TEXT

> seed document <DOC_ID> edit --preview
Draft created <DRAFT_ID>
<PREVIEW_MD>

> seed draft <DRAFT_ID> edit --replace <FULL_REPLACED_MD> --preview
Draft edited
<PREVIEW_MD>

> seed draft <DRAFT_ID> edit --replace-html <FULL_REPLACED_HTML> --preview
Draft edited
<PREVIEW_HTML>

> seed draft <DRAFT_ID> edit --replace-html-file <HTML_FILE_PATH> --preview
Draft edited
<PREVIEW_HTML>

> seed draft <DRAFT_ID> edit --node="BLOCK_ID" --replace-html-file <HTML_FILE_PATH> --preview
Draft edited
<PREVIEW_HTML>

> seed draft <DRAFT_ID> publish


> seed document <DOC_ID> edit --ops "<EXACT_JSON_OPS>" -y
One shot! doc edited and published

```

# TODOS:

- [ ]
- [ ]
- [ ]
- [ ]
- [ ]
- [ ]
- [ ]
- [ ]
- [ ]
