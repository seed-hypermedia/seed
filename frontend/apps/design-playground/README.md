# Seed design playground

A client-only Vite + React workbench for the shared Seed theme. No server, router, account or daemon required.

## Run

From the repo root (with the direnv environment loaded):

```sh
pnpm --filter @shm/design-playground dev
pnpm --filter @shm/ui storybook
```

Open http://localhost:6007. The fixed charcoal panel changes the canvas, not itself; on mobile, use **Theme** to open
it. All preview components are real `@shm/ui` exports wrapped in the shared offline `StoryProviders`. Publishing and
saving are local demos.

Seed defaults are left completely untouched until a control changes. Presets affect both modes; advanced color edits
affect the selected mode and override presets. Clear a token with ↺ or **Reset** the whole theme. Invalid CSS color
drafts are marked and never applied. **Copy CSS** exports only changed properties. **Share this theme** copies a
self-contained URL hash; it needs no storage or API. A clipboard fallback lets you copy manually when browser
permissions deny access.

Color tokens are discovered from the literal `:root` and `.dark` declarations in `@shm/ui/theme.css?raw`, excluding
non-color properties and Tailwind mappings. Browser canvas conversion resolves computed OKLCH/LCH/variable colors to
sRGB for live WCAG 2 contrast checks. AA means 4.5:1 for normal text. Translucent colors are composited; out-of-gamut
colors are clipped to sRGB. These six text checks are not a complete accessibility audit.

## Build and links

- `pnpm --filter @shm/design-playground build`: standalone `dist/`.
- `pnpm --filter @shm/design-playground build:site`: playground at `dist/`, Storybook under `dist/storybook/`. Serve
  that directory with any static server; no deployment workflow is added.
- Standalone links: `VITE_STORYBOOK_URL` defaults to `http://localhost:6006`; Storybook's `STORYBOOK_PLAYGROUND_URL`
  defaults to `http://localhost:6007`. Both accept relative paths. The combined build sets `./storybook/` and `../`
  respectively.
- `pnpm --filter @shm/design-playground test`: theme parser, scale, serializer, URL validation and WCAG math tests. Root
  `pnpm test` includes them. Root recursive typecheck/format commands discover this package automatically.

## Canvas scope

Typography, swatches, every Button variant/size, badge variants, input/textarea states, checkbox/radio/switch, tabs,
select, tooltip, dialog, alert dialog, progress, toast, account identity/profile name, explorer person/document cards,
content embed, activity event, connections panel, notice and domain publishing status. Each card links to an existing
Storybook story.

The canvas is a curated kitchen sink, not a replacement for the complete Storybook catalogue.
Account/security/server-settings dialogs and destructive editor/publishing workflows stay in Storybook: they need
workflow-specific state and would duplicate the same primitives here. Editor rendering, live iframe applications,
uploads and network services are intentionally not run. There is no shared Slider component in this UI package; native
ranges are used only in the theme controls. Calendar, menus, tables, navigation and other secondary compositions remain
in Storybook rather than crowding this single-page theme sampler.
