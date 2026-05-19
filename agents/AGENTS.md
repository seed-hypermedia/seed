# Agents Rules

- Applies to `agents/**`.
- `agents/**` is a Bun workspace and is separate from the pnpm workspaces in the rest of the repository.
  - Use Bun commands and scripts in this subtree. Don't use `pnpm`, `npm`, `vite` or root package commands in this
    folder.
  - Never import repo-root files from outside the agents root directly. Use `file:` dependencies in `package.json`.
- Before finishing Agents work, run `bun check` and `bun test` from `agents/`.
- Prefer namespace imports over destructuring imports.
- Do not log secret values, provider secret config, signed request bodies, or session contents unless explicitly
  debugging locally.
- For configuration see the top comment of `./src/config.ts`.
