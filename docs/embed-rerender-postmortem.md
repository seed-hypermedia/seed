# Post-mortem: embeds re-rendering / flashing every second (desktop)

**Date:** 2026-06-03
**Affected:** Desktop app, production release 2026.6.1 (latent in `main` too)
**Severity:** Visible jank — embedded documents flashed/re-rendered ~once per second while viewing a document. No data loss.
**Fix:** `fix(editor): stop embeds re-rendering on every ancestor render` + `fix(ui): render Spinner as <span> …`

---

## TL;DR

`RenderResourceProvider` memoized its context value on the **`resource` object reference**, but every call site passes an **inline object literal** (`resource={{kind, id}}`). A new object every render → the memo recomputed every render → it produced a **new array** as the context value → **every embed in the subtree re-rendered whenever any ancestor re-rendered**.

In production the ancestor (the document editor) re-renders ~once per second on the desktop activity-poll's query invalidations → embeds flashed every second. In dev you could trigger the same path just by scrolling.

The fix: memoize the provider value on a **primitive identity key** instead of the object reference, plus memoize the embed's `id` so it stops handing a fresh `blockRange` prop downstream.

---

## Symptom

- Open a document containing embedded documents on desktop.
- The embeds visibly re-render / flash roughly once per second, even when nothing in them changed.
- Web was unaffected. Only desktop.

## What made it slippery

We changed our root-cause hypothesis **three times** before landing it. Each false lead looked plausible and each was killed by a measurement, not an argument. Worth internalizing:

1. **First guess — the 1s desktop activity poll invalidating `ENTITY` queries.**
   `frontend/apps/desktop/src/app-sync.ts` polls the activity feed every 1s and invalidates React Query caches. Looked like the obvious "every second" culprit.
   **Killed by:** profiling showed that on a quiet document the poll found **zero** events and fired **zero** `ENTITY` invalidations — yet embeds still re-rendered. (We even temporarily bumped the poll interval to 10s; the re-render cadence didn't budge.)

2. **Second guess — the document editor re-applying its content.**
   The editor's XState machine calls `applyInitialContent → editor.replaceBlocks` on entering the `editing` state, which rebuilds every tiptap NodeView (embeds are NodeViews). We saw repeated `flushSync` warnings from that path.
   **Killed by:** instrumented logging showed `applyInitialContent` fires only a handful of times at **startup**, not continuously. (Those `flushSync` warnings are a real but separate, pre-existing, dev-only issue.)

3. **Third guess — discovery progress stream churn.**
   `useResource({subscribed:true}) → useDiscoveryState → useStream` re-renders on every discovery-progress write.
   **Killed by:** discovery uses a unary RPC retried ~every 2s, far too slow to explain the ~10ms continuous re-render cascade we were measuring.

4. **Actual cause — found with a "why-did-render" probe.**
   We added a render logger that recorded *which tracked input changed reference* on each embed render. The answer was unambiguous:
   - `BlockEmbedContent` re-rendered with `changed=[renderResourceStack]`
   - `BlockEmbedContentDocument` re-rendered with `changed=[blockRange]`

That single field ended the guessing.

## Root cause

`frontend/packages/shared/src/render-resource-context.tsx` provides the "render-resource ancestry stack" (used for embed-cycle detection) via React context:

```tsx
// BEFORE
const value = useMemo(
  () => (resource?.id ? [...parentStack, resource] : parentStack),
  [parentStack, resource],          // <-- keyed on the resource OBJECT
)
```

Every call site passes the resource as an **inline literal**:

```tsx
<RenderResourceProvider resource={{kind: 'document', id}}>   // new object every render
```

So `resource` is a new reference on every render → the `useMemo` dependency changes every render → `value` is a brand-new array every render. A React **context value identity change re-renders every consumer**, regardless of whether the consumer's own props/state changed. Every embed reads this context (`useRenderResourceStack()`), so **all embeds re-rendered on every ancestor render**.

Why "every second" in production, "on scroll" in dev:
- Both are just *ancestor re-renders*. The unstable context turned any ancestor render into an all-embeds render.
- **Production:** the document editor re-renders ~1×/s from the activity poll's query invalidations (account/feed/etc. broadcasts) → embeds flash every second.
- **Dev:** scrolling sends a `scroll` event into the document machine (`useScrollSync`), which re-renders the editor subtree → same cascade.

Secondary amplifier: `BlockEmbedContent` recomputed `id` (via `unpackHmId(block.link)` + spread) on every render, so it handed `BlockEmbedContentDocument` a fresh `blockRange` object each time — re-rendering it even after the context was stabilized.

## The fix

`render-resource-context.tsx` — memoize on a **primitive identity key**, not the object:

```tsx
// AFTER
const resourceKey = resource?.id
  ? `${resource.kind}|${resource.id.id}|${resource.id.version ?? ''}|${resource.id.latest ? 1 : 0}|${resource.id.blockRef ?? ''}`
  : ''
const value = useMemo(
  () => (resource?.id ? [...parentStack, resource] : parentStack),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [parentStack, resourceKey],
)
```

Now object-identity churn at the call sites is ignored; the array is rebuilt only when the resource *actually* changes. Because `parentStack` is itself a now-stable context value, the whole provider chain stabilizes.

`embed-views.tsx` — memoize `id` on `block.link` so `id`/`id.blockRange` stay referentially stable across re-renders.

### Result (measured)

- Continuous ~10ms re-render churn: **gone.**
- Residual renders: only `changed=[]` at the editor's natural ~2s ticks — i.e. the parent re-rendered with **no input change**, so React reconciles to the same DOM and there is **no visual flash**. These are benign; we deliberately did **not** add `React.memo` to chase them (it wouldn't bail without first stabilizing unstable callback props, and adds staleness risk for zero user-visible gain).

## Why this was a latent footgun

A `useMemo`/`useContext` value keyed on an object that callers construct inline is effectively **not memoized at all** — and when that value is a *context value*, the cost is paid by **every consumer in the subtree**, not just the provider. It's invisible until something upstream starts re-rendering often (here, a 1s poll), at which point it amplifies into a whole-subtree storm.

## Lessons / how to avoid

1. **Context values must be referentially stable.** If a provider's value is derived from props that callers pass as inline literals, memoize on **primitive keys**, not the object/array reference. Treat an unstable context value as a perf bug by default.
2. **Measure, don't argue.** Three confident hypotheses were each wrong. A "1s symptom" does **not** imply a "1s timer" is the cause — it can be any ancestor that happens to re-render on that cadence. The decisive tool was a tiny *why-did-render* probe (`Object.is` diff of tracked inputs per render); a quick A/B (bump the poll to 10s) cheaply exonerated the prime suspect.
3. **Distinguish trigger from amplifier.** The activity poll was the *trigger* (it re-renders the editor); the unstable context was the *amplifier* (it turned that into an all-embeds render). Fix the amplifier and the trigger becomes harmless.
4. **A re-render is not a flash.** After the fix, embeds still re-render at ~2s with `changed=[]` — harmless, because no input changed so the DOM doesn't update. Don't over-optimize benign re-renders.

## Related, separate issue (not the flashing)

While investigating we noticed pre-existing, **dev-only** console warnings, unrelated to the flashing:

- `flushSync was called from inside a lifecycle method` — from `applyInitialContent → editor.replaceBlocks` (tiptap mounts NodeViews with `flushSync`). The editor's init is intentionally synchronous, so we left this alone.
- `validateDOMNesting: <div> cannot appear as a descendant of <p>` — the `Spinner` rendered a `<div>` inside the document-header author `<p>`/`<a>`. **Fixed** by rendering `Spinner` as a `<span>` (it was already styled `inline-block`, so visually identical and valid everywhere). This also removes a real web-SSR hydration risk.

## Touched files

- `frontend/packages/shared/src/render-resource-context.tsx` — primitive-key memo (primary fix).
- `frontend/packages/ui/src/embed-views.tsx` — memoize embed `id` on `block.link`.
- `frontend/packages/ui/src/spinner.tsx` — `<div>` → `<span>` (separate DOM-nesting fix).

## How to verify

1. Desktop: open a document with embeds; scroll and sit idle — embeds no longer flash/re-render (use React DevTools Profiler "Highlight updates" to confirm).
2. Embed-cycle detection still works (open a self-embedding document → cycle banner).
3. Block-fragment highlight still lands on the correct text.
4. Spinners (author link, breadcrumb loading, page/embed loaders) still render and spin; `validateDOMNesting` warning is gone.
