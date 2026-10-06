# @shm/ui

Seed's shared React components and design tokens. The npm package exposes the reusable UI primitives; Seed's
application-specific components remain available only inside the monorepo.

## Outside the Seed workspace

Install `@shm/ui` alongside React and React DOM (18 or 19):

```sh
npm install @shm/ui react react-dom
```

```tsx
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {CodeInput} from '@shm/ui/components/code-input'
import '@shm/ui/styles.css'
import './app.css'
```

`styles.css` is ready-to-use CSS, including the shared light/dark palette and utilities used by the published
components. It does not include a browser reset. Load it before your application's styles so application overrides and
responsive utilities take precedence. No Tailwind installation or configuration is required. Supply your own styles for
any additional `className` utilities. The `.dark` ancestor selects dark mode.

For a Tailwind 3 consumer, use one CSS entry point with `@import '@shm/ui/styles.css';` before the `@tailwind`
directives. This preserves stylesheet order in development and production. Do not put only the shared stylesheet in a
lower-priority cascade layer while leaving the application's reset unlayered: the reset would override shared component
styles regardless of selector specificity.

Tailwind 4 applications can instead import `@shm/ui/theme.css` and `@shm/ui/base.css` into their Tailwind entry
stylesheet and scan this package's JavaScript with `@source`. `tokens.css` provides only the palette as plain CSS custom
properties.

Public exports:

- `button`: `Button`, `ButtonLink`, `buttonVariants`, `ButtonProps`
- `components/input`, `components/dialog`, `components/label`, `components/code-input`
- `components/badge`, `components/textarea`, `components/skeleton`
- `seed-logo`, `utils`
- `input`, `dialog`, and `label` are aliases for their `components/` subpaths.
- The package root re-exports all published components.

## Build and release

From the Seed repository, run:

```sh
direnv exec . pnpm --filter @shm/ui test:package
direnv exec . pnpm --filter @shm/ui pack:public
# Requires npm authentication with publish access to the @shm scope:
direnv exec . pnpm --filter @shm/ui publish:public
```

The build compiles the actual shared component sources to native ESM and declarations, generates CSS for that surface,
and creates a standalone manifest in `dist`. It rejects private workspace dependencies. `test:package` checks the packed
artifact in an isolated consumer, including runtime rendering and TypeScript resolution. Bump this package's version
before publishing a new release; npm versions cannot be overwritten.

The source package remains private and keeps its existing workspace exports. Always publish the generated `dist`
package, never the source manifest: it also contains Seed application-specific dependencies that are not part of the
public contract.
