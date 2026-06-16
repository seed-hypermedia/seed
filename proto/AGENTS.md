# Proto Rules

- Applies to `proto/**`.
- When editing proto definitions, run `./dev gen //proto/...` from the repository root.
- Do not run `buf` or `protoc` directly.
- Proto changes ripple into Go and TS callers — validate downstream impact locally via agent-ci:
  - Backend: `npx @redwoodjs/agent-ci run -w .github/workflows/lint-go.yml -p` and
    `npx @redwoodjs/agent-ci run -w .github/workflows/test-go.yml -p`
  - Frontend: `npx @redwoodjs/agent-ci run -w .github/workflows/test-frontend-parallel.yml -p --github-token`
  - See `docs/local-ci-with-agent-ci.md`.
- Never explicitly run formatters on the generated protobuf code.
