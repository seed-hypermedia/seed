# Vault Rules

- Applies to `vault/**`.
- `vault/**` is a Bun workspace and is separate from the pnpm workspaces in the rest of the repository.
- Use Bun commands and scripts in this subtree. Don't use `pnpm`, `npm`, `vite` or anything like that in this folder.
- Before finishing Vault work, run `bun check`, and `bun test` from `vault/`.
- Do not suppress Biome warnings unless it is a confirmed false positive with a short justification.
