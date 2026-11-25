# Frontend Rules

- Applies to `frontend/**`.
- Follow the existing design system. Reuse components, design tokens, and nearby UI patterns before adding new ones.
- Keep interfaces clear and consistent. Show only information that helps the user complete the task.
- Preserve accessibility: keyboard navigation, visible focus, accessible labels, and reduced-motion preferences.
- Handle loading, empty, error, and disabled states where relevant.
- Test new or changed behavior, including regression tests for bug fixes. Test observable results rather than
  implementation details; styling-only changes do not need unit tests.
- Before completion, run typechecks and relevant tests for affected packages and their dependents. Verify changed
  interactions and visual changes in a browser. Follow the root rules for formatting, broader checks, and reporting.
- Use package scripts and the package's configured package manager; mobile is separate from the pnpm workspace.
- when any UI changed is made, show a before and after screenshots when possible.
