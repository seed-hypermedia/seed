# @seed-hypermedia/ui

Seed's shared React components and design tokens. The npm package exposes the reusable UI primitives; Seed's
application-specific components remain available only inside the monorepo.

## Outside the Seed workspace

Install `@seed-hypermedia/ui` alongside React and React DOM (18 or 19):

```sh
npm install @seed-hypermedia/ui react react-dom
```

```tsx
import {Button} from '@seed-hypermedia/ui/button'
import {Input} from '@seed-hypermedia/ui/components/input'
import {CodeInput} from '@seed-hypermedia/ui/components/code-input'
import '@seed-hypermedia/ui/styles.css'
import './app.css'
```

`styles.css` is ready-to-use CSS, including the shared light/dark palette and utilities used by the published
components. It does not include a browser reset. Load it before your application's styles so application overrides and
responsive utilities take precedence. No Tailwind installation or configuration is required. Supply your own styles for
any additional `className` utilities. The `.dark` ancestor selects dark mode.

For a Tailwind 3 consumer, use one CSS entry point with `@import '@seed-hypermedia/ui/styles.css';` before the
`@tailwind` directives. This preserves stylesheet order in development and production. Do not put only the shared
stylesheet in a lower-priority cascade layer while leaving the application's reset unlayered: the reset would override
shared component styles regardless of selector specificity.

Tailwind 4 applications can instead import `@seed-hypermedia/ui/theme.css` and `@seed-hypermedia/ui/base.css` into their
Tailwind entry stylesheet and scan this package's JavaScript with `@source`. `tokens.css` provides only the palette as
plain CSS custom properties.

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
# Requires npm authentication with publish access to the @seed-hypermedia scope:
direnv exec . pnpm --filter @shm/ui publish:public
```

The build compiles the actual shared component sources to native ESM and declarations, generates CSS for that surface,
and creates a standalone manifest in `dist`. It rejects private workspace dependencies. `test:package` checks the packed
artifact in an isolated consumer, including runtime rendering and TypeScript resolution. The offline check reuses
installed third-party dependencies; `test:package:install` instead performs a clean npm install of the tarball and its
dependencies, and is the release check in CI. Bump this package's version before publishing a new release; npm versions
cannot be overwritten.

The source package remains private as `@shm/ui` and keeps its existing workspace exports. The public npm package is
`@seed-hypermedia/ui`. Always publish the generated `dist` package, never the source manifest: it also contains Seed
application-specific dependencies that are not part of the public contract.

## GitHub release workflow

[Publish UI package](../../../.github/workflows/publish-ui.yml) validates changes on pull requests and pushes to `main`.
It checks formatting and types, runs the UI tests, builds the public package, and installs its tarball into a clean
consumer before testing its exports, rendering, declarations and CSS. The resulting artifact contains the exact package
that can be released. Merging runs validation; it does not publish to npm.

Before the first release, an owner of the `@seed-hypermedia` npm scope must grant the publishing account permission to
create `@seed-hypermedia/ui` and configure the Seed GitHub repository secret `UI_NPM_TOKEN`. Use a granular npm token
with write access to the scope/package and permission to bypass 2FA for non-interactive publishing. Keep its permissions
narrow and its expiry short. This workflow does not assume npm trusted-publisher configuration already exists. It uses
the token for publication and GitHub's OIDC permission only for the provenance statement. See npm's
[CI authentication](https://docs.npmjs.com/using-private-packages-in-a-ci-cd-workflow/) and
[provenance](https://docs.npmjs.com/generating-provenance-statements/) documentation.

After merging the release commit, run **Actions → Publish UI package → Run workflow** on `main`, set `publish` to
`true`, and enter the exact checked-in `expected_version` (`0.1.0` for the first release). The workflow rejects a
version mismatch or publication from another branch, and publishes the validated tarball with public access and
provenance. It never increments versions automatically. A version already present on npm requires an explicit new
version in the source manifest.

Once `npm view @seed-hypermedia/ui@0.1.0 version` succeeds, update SeedHost's npm and Yarn lockfiles, verify a clean
install and production build, and only then enable its Render deployment. A local tarball test does not establish that
the npm package is available to Render.

## Local image uploads

The desktop and web apps share `image-processing`. Vault profile forms use the same cropper and image validation. Only
the resulting image is sent to storage. Decoding, conversion, cropping, and resizing run locally; they do not call an
image-conversion service. Video processing is not included.

- Uncropped uploads use `processImage` with the avatar, cover, or content policy.
- Crop fields retain the full-resolution source until the user confirms the crop. HEIC uses a full-resolution, lossless
  PNG preview. Other supported still formats retain their original source for cropping.
- The confirmed crop is the final encoded file. Shared upload adapters reuse it when its dimensions and byte size
  satisfy their policy. A stricter policy still applies its limits.
- Crop fields reject animated images with a visible error. Uncropped uploads preserve supported animation when it fits
  the policy. They reject oversized animation rather than silently flattening it.
- Static output is re-encoded without source metadata. Preserved animations retain their original bytes and metadata.
- Input validation limits files to 64 MiB, 100 million pixels, and 32,768 pixels on either axis. Output limits differ by
  surface. Unsupported or malformed images fail with an error; this is not support for every image format.

`file-drop-guard` is independent of image processing. App roots use it to stop browser navigation for unhandled file
drops. Component handlers still receive drops. Text and link drops keep their existing behavior. This does not turn
every screen into an upload target.

## Verification

Run unit tests with `direnv exec . pnpm --filter @shm/ui test`. The editor package contains real-browser image tests and
a generated HEIC fixture. Start its documented harness on `http://localhost:5180` with
`direnv exec . pnpm --filter @shm/editor test:harness`. These tests check local processing and crop behavior, not a
complete authenticated storage flow in every app.

## Image-processing release gate

Applications consuming `@shm/ui/image-processing` must package `THIRD_PARTY_NOTICES.md` with their distribution and
verify in their production build that `heic-to` remains a separate, lazily loaded chunk rather than startup code. Review
the dependency license obligations before distribution. Decoding currently runs on the renderer thread; worker-based
processing is not included.
