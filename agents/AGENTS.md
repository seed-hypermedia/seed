# Agents Rules

- Applies to `agents/**`.
- `agents/**` is a Bun workspace and is separate from the pnpm workspaces in the rest of the repository.
  - Use Bun commands and scripts in this subtree. Don't use `pnpm`, `npm`, `vite` or root package commands in this
    folder.
  - Never import repo-root files from outside the agents root directly. Use `file:` dependencies in `package.json`.
- Before finishing Agents work, run `bun check` and `bun test` from `agents/`, and commit anything `bun check`
  reformats.
  - `bun check` runs Prettier (`format:write`) over the **entire** `agents/` subtree — Markdown, HTML, JSON, etc., not
    just `.ts`. Any file you edit or add (including `docs/*.md` and `*.html`) must be Prettier-formatted.
  - The release workflow's frontend `Lint` job runs `bun run format:check` here; a single unformatted file fails it and
    **blocks the web image build** (`docker-web`). Run `bun run format:check` to confirm clean before committing — do
    not hand-format individual files or assume only source files are checked.
- Prefer namespace imports over destructuring imports.
- Do not log secret values, provider secret config, signed request bodies, or session contents unless explicitly
  debugging locally.
- For configuration see the top comment of `./src/config.ts`.
