# Publish the Umbrel and CasaOS stores

One public GitHub repository can serve both stores. Umbrel reads `umbrel-app-store.yml` and direct-child app manifests
from the repository's default branch; CasaOS searches the ZIP archive recursively for an `Apps/` directory. The combined
root is:

```text
umbrel-app-store.yml
seed-site/
Apps/Seed/
README.md
```

## Create and publish the store

Create an empty public GitHub repository named `seed-apps` under your account or organization. Do not initialize it with
a README, license, or `.gitignore`.

From the root of the Seed checkout, replace `<owner>` with the repository owner and run:

```sh
STORE_DIR="$(mktemp -d)/seed-apps"
git clone "https://github.com/<owner>/seed-apps.git" "$STORE_DIR"
cp -a ops/umbrel/umbrel-app-store.yml "$STORE_DIR/"
cp -a ops/umbrel/seed-site "$STORE_DIR/"
cp -a ops/casaos/Apps "$STORE_DIR/"
printf '# Seed app store\n\nSeed Hypermedia apps for Umbrel and CasaOS.\n' > "$STORE_DIR/README.md"
cd "$STORE_DIR"
git add umbrel-app-store.yml seed-site Apps README.md
git commit -m "Publish Seed apps for Umbrel and CasaOS"
git push -u origin HEAD:main
```

The `cp -a` command keeps both Umbrel `data/*/.gitkeep` files in the published store. Both icons currently use jsDelivr
URLs under `horacioh/seed@custom-images`; merge PR #39 before publishing so those URLs can load.

## Add the store

- **Umbrel:** Open **App Store → ⋯ → Community App Stores**, add `https://github.com/<owner>/seed-apps`, then install
  **Seed Site**.
- **CasaOS:** Add `https://github.com/<owner>/seed-apps/archive/refs/heads/main.zip` as a third-party store source, then
  install **Seed Hypermedia**. The exact source-settings labels in CasaOS 0.4.15 were not verified.

After adding the source, confirm its listing appears, install the app, and open `http://<server>:3567/hm/register` (or
the configured public URL). Obtain the registration secret from the password shown by Umbrel or from the `seed-web`
service logs in CasaOS.

## Update the store

- **Umbrel:** Update the pinned image digests and `version` in `seed-site/umbrel-app.yml`, copy the updated `seed-site/`
  into the store checkout, commit, and push `main`. Umbrel offers an app update when the version changes.
- **CasaOS:** Bump `version` and `update_at` in `Apps/Seed/docker-compose.yml`, then commit and push `main`.

This combined layout is based on source inspection. Local git/ZIP store installs were tested, but the GitHub-hosted
store URL and archive URL were not.

## Future official catalog submissions

- For a PR to [getumbrel/umbrel-apps](https://github.com/getumbrel/umbrel-apps), first publish arm64 multi-architecture
  images; use versioned image tags if available. Put gallery images in the PR body, do not commit the icon, set the
  manifest's `submission` field to the official PR URL, and complete the `umbrel-test-app` checklist.
- For a PR to [IceWhaleTech/CasaOS-AppStore](https://github.com/IceWhaleTech/CasaOS-AppStore), follow its `CONTRIBUTING`
  guide and add `arm64` to `architectures` once arm64 images are available.
