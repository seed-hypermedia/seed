# Frontend Rules

- Applies to `frontend/**`.
- Use pnpm workspace commands in this subtree.
- Before making any changes or plans, ask any clarifying questions until you are 95% sure what needs to be done
- After finishing frontend work:
  - if you can add tests to the current feature/fix worked, please do.
  - make sure `pnpm typecheck` pass.
  - make sure all tests pass (`pnpm test`).
  - make sure `pnpm audit` pass.
  - make sure run `pnpm format:write`
- For full CI parity before pushing, validate locally via agent-ci:
  `npx @redwoodjs/agent-ci run -w .github/workflows/test-frontend-parallel.yml -p --github-token`.
  See `docs/local-ci-with-agent-ci.md` for setup, the fix-and-retry loop, and what to skip.
