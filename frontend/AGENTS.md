# Frontend Rules

- Applies to `frontend/**`.
- Use pnpm workspace commands in this subtree.
- Before making any changes or plans, ask any clarifying questions until you are 95% sure what needs to be done
- UI polish rules:
  - Use existing design tokens for colors, spacing, radius, duration, easing, and shadows. If a new token is needed,
    define it once and reuse it; do not scatter one-off visual values.
  - Avoid generic browser easing (`ease`, `ease-in-out`) for new motion. Use the project motion tokens, or define a
    small named set such as smooth, out, spring, and in-out before using custom curves.
  - Treat components as state systems, not static pictures. Design and build the meaningful states: idle, hover,
    pressed, focused, loading, disabled, error, empty, and success when applicable.
  - Give interactive controls tactile feedback. Pressed states should feel subtle and firm, not exaggerated; hover,
    focus, tooltip, and loading feedback should be intentional instead of instant or generic.
  - Prefer entrance motion that combines opacity with a small translate and/or blur clear. Avoid plain fade-only
    entrances unless reduced motion or context calls for it.
  - Use layered low-opacity shadows or rings for depth instead of one heavy drop shadow.
  - For draggable UI, use real interaction behavior: momentum, soft boundaries, and snap points where meaningful.
  - For expand/collapse, animate to real content size with layout-aware techniques; avoid fake `max-height: 9999px`
    tricks. Use FLIP-style measurement for elements moving between containers when needed.
  - Respect accessibility and performance as part of polish: honor reduced motion, preserve keyboard/focus behavior,
    and avoid expensive animations across long lists or large surfaces.
  - When handing off from Figma or another design source, explicitly match tokens, padding, gaps, colors, radius,
    type sizes, type weights, and known variants. Do not assume the handoff is pixel-perfect without checking.
- After finishing frontend work:
  - if you can add tests to the current feature/fix worked, please do.
  - make sure `pnpm typecheck` pass.
  - make sure all tests pass (`pnpm test`).
  - make sure `pnpm audit` pass.
  - Formatting (the CI `Lint` job runs `prettier --check` per package and fails on ANY unformatted file):
    - Run `pnpm -r format:write` across the WHOLE workspace, then confirm with `pnpm -r format:check`.
      Do NOT run prettier on only the files a CI log happens to name — turbo interleaves parallel package
      output and `head`/grep truncation hides other offenders, so a per-file fix passes locally but CI still
      fails on the files you missed. Always fix and re-check the whole workspace.
    - Local `format:check` may flag gitignored build artifacts (e.g. `packages/editor/e2e/playwright-report/**`,
      `test-results/**`) that do not exist on CI. Confirm with `git check-ignore <file>`; ignore those, but never
      assume a warning is an artifact without checking — tracked source files must be formatted.
- For full CI parity before pushing, validate locally via agent-ci:
  `npx @redwoodjs/agent-ci run -w .github/workflows/test-frontend-parallel.yml -p --github-token`.
  See `docs/local-ci-with-agent-ci.md` for setup, the fix-and-retry loop, and what to skip.
