# Author account labels — real web query screenshots

Origin: https://seedteamtalks.hyper.media/tasks/author-not-resolving-in-list-view
Baseline: upstream `main` commit `00ee936ff257d42563c81e6b92362522153b7ae6`.
Query: https://hyper.media/hm/z6MkpVa5nMUR5ZaUEyV1SE48KTNbwTuHRd83RwLgMKc4nGU3/ion/progress/author-list-account-labels/repro (read-only List version of the actual Issue Tracker task query, same included space and selected Owner column). Original live issue-tracker query currently defaults to Table; visitor cannot change it without write access.

`before.png`: Chromium 1480×950, real hosted web app with the published List query. `Author not resolving in list view` Owner visibly shows `hm://z6MkgisVMELvqnsCo3dYmtVpy8PiqPGMVwfAyBWFn84vebq4`; SHA-256 `40126b622827c2de1da72fa5d037ff1ea4469f8cae831067d453e60f7d6602d8`.

`after.png`: same URL, viewport, real public task data and Chromium; candidate `pnpm --filter @shm/web build` JavaScript assets intercepted from the approved dev worktree rather than deployed production assets. Live page SSR/data are unmodified. Because the hosted SSR has different CSS hashes, Chromium reports a hydration warning and client-rerenders before capture. Playwright asserts 25 rendered query rows, the target row contains `Eric Vicenti`, and the raw account URL is absent. SHA-256 `5058f26aa87b203ba3c8969149bf93a1b58ac06d7d4f9430379d508e29d58706`. This is a real running app with real documents, not a mocked callback, but not a deployed production patch.

Clean-main regression: focused Vitest `query-block-content.test.tsx -t "account labels"` failed for both List and Card on the expected visible text. Unchanged assertions passed (2/2) on candidate. Model edge-case regression covers mixed arrays, missing account metadata, and document references. Focused suite 81/81 passed.
