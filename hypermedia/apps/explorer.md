---
name: The Explorer
summary: The Hypermedia Explorer, a browser app at explore.hyper.media for looking at the raw data behind any hm:// or ipfs:// URL, following the activity feed, and trying Seed API requests against a site.
---
The Hypermedia Explorer shows you what is actually on the network, as raw data. Paste an `hm://` URL, an `ipfs://` [CID](../protocol/blobs.md) or the web address of a Seed page, and it shows the resource as data: the [document](../protocol/documents.md)'s metadata and [blocks](../protocol/blocks.md), its change history, [comments](../protocol/comments.md), citations, [capabilities](../protocol/permissions.md) and children. It also lists the network's root documents, follows the activity feed, decodes any blob, and has an API lab for trying [Seed API](../build/web-api.md) requests by hand. Use it to see what a [daemon](./daemon.md) really has. The public copy is at `https://explore.hyper.media`. <!-- id:JjrZGIrW -->

# Where the code is <!-- id:2mrFrRrq -->

`frontend/apps/explore`, package `@shm/explore`: a static single-page app built with Vite 6, React 18, react-router 7 and Tailwind. It has no server of its own. It uses `@seed-hypermedia/client`, `@shm/shared` and `@shm/ui` straight from source through Vite aliases. <!-- id:13Wpb7G9 -->

<!-- id:vCOhad9J -->
| Path <!-- col:wB1tGoGq --> | What it holds <!-- col:bh0y_tLr --> <!-- id:K_i673lS --> |
| --- | --- |
| `src/main.tsx`, `src/App.tsx` | Entry point and routes. <!-- id:HHwCMhVW --> |
| `src/universal-client.ts` | The data layer: a web universal client whose requests go to the configured API host. <!-- id:mZ3icQDV --> |
| `src/queryClient.ts`, `src/apiHostStore.ts` | The API host setting. <!-- id:qnCswXnI --> |
| `src/components/HM.tsx`, `src/components/tabs/` | The resource view and its tabs. <!-- id:hFFjlt9- --> |
| `src/components/IPFS.tsx` | The [blob](../protocol/blobs.md) view. <!-- id:XGjbwh9- --> |
| `src/components/ApiLab.tsx`, `src/api-lab.ts` | The API lab; the logic lives in `@shm/shared/api-lab`. <!-- id:TYXq7JHM --> |
| `src/components/Feed.tsx`, `src/components/List.tsx` | The activity feed and the root [document](../protocol/documents.md) list. <!-- id:FXn96u3Z --> |

The README still describes a Yarn workflow; the app is part of the pnpm workspace, and the commands below are the ones that work. <!-- id:VDF0zMgg -->

# How it talks to the daemon <!-- id:5oTlo2Be -->

The Explorer never talks to a [daemon](./daemon.md). It talks to a Seed [web app](./web.md)'s API: every request is `createSeedClient(apiHost).request(key, input)`, so the Explorer shows exactly what that [site](../protocol/sites.md)'s daemon can see. The API host defaults to `VITE_PUBLIC_EXPLORE_API_HOST`, or `http://localhost:3000` when that is not set at build time, and you can change it in the settings panel behind the gear icon. The choice is saved in the browser's `localStorage`. <!-- id:zeeFqNUm -->

Point it at a local web app to inspect your dev node, at `https://hyper.media` to see the gateway's view, or at any site to see what that site's daemon has synced. The same resource can look different on two hosts, and that difference is often the answer to a sync question. <!-- id:acTWcDqX -->

# What it shows <!-- id:VmDDbnlS -->

<!-- id:dvNfTV52 -->
| Route <!-- col:s3u4Av3M --> | View <!-- col:XUNvTTnU --> <!-- id:uMX2M_2- --> |
| --- | --- |
| `/` | A search box for `hm://`, `ipfs://` and `https://` URLs of Hypermedia [documents](../protocol/documents.md). <!-- id:t0VyRmc9 --> |
| `/hm/<account>/<path>` | A resource. Tabs, each with a count, cover the document, changes, [comments](../protocol/comments.md), citations, [capabilities](../protocol/permissions.md), child documents, comments the [account](../protocol/identity.md) wrote, the profile, and a comment's versions. [View terms](../protocol/urls.md) such as `/:comments` select a tab, the same way they do in the [web app](./web.md). <!-- id:QsdTr7YK --> |
| `/ipfs/<cid>` | A decoded [blob](../protocol/blobs.md), with signer principals shown as `hm://` links, copy and download buttons, and [schema](../schema.md) awareness: a schema blob is recognised, and a blob that names a schema is checked against it. <!-- id:QB0F4jaY --> |
| `/list` | The root documents the host knows. <!-- id:LiagHAj4 --> |
| `/feed` | The activity feed, paged, with the latest event. <!-- id:QhF7lnIg --> |
| `/api-lab` | The API lab. <!-- id:Mtg-vyVB --> |

A resource that is not found, deleted or redirected is shown as a status panel that names the state, which makes [tombstones and redirects](../ref.md) easy to see. <!-- id:Qn6hxrpk -->

# The API lab <!-- id:XV2kEdBG -->

The API lab is a playground for the Seed API. It loads `GET /api/schema` from the API host, which lists every request key with its kind (query or action), method and path, and `GET /api/schema?key=<Key>` for one key's JSON Schema for input and output. Pick a key and the lab generates a starter payload, shows the exact HTTP request it will send, including the query string or CBOR body, sends it, and shows the result. The [desktop app](./desktop.md)'s API bridge and every [web app](./web.md) serve the same schema endpoint, so the lab works against either. [The web API](../build/web-api.md) documents the same keys. <!-- id:aGx-5awQ -->

# Running it <!-- id:jFROeEL8 -->

```sh <!-- id:P69GGENR -->
pnpm explore                     # Vite dev server on :5173, reading from the web app on :3000
pnpm explore:build               # static build in frontend/apps/explore/dist
pnpm --filter @shm/explore test
```

`./dev up` starts it as the `explore` pane beside the [web app](./web.md) it reads from. The build is a folder of static files that any web host can serve. The hosted copy at explore.hyper.media is served from behind Cloudflare and reads from hyper.media; its deployment is not defined in this repository. <!-- id:uTlsb0It -->

# Working with it <!-- id:zc2FKEX8 -->

## In the Seed app <!-- id:iZHAQiOE -->

The desktop app has its own inspector for the same purpose, the [blob](../protocol/blobs.md) and metadata editors described in [the desktop app](./desktop.md). The Explorer covers the reading part in any browser, against any [site](../protocol/sites.md). When built with `VITE_SEED_WEB_ORIGIN`, its blob view links to that [web app](./web.md)'s inspector for editing. <!-- id:v0S31DxT -->

## CLI <!-- id:nmonk-1f -->

`seed-cli document get`, `seed-cli blob` and `seed-cli activity` read the same data from a terminal. Use `--json` to get what the Explorer shows. See the [CLI reference](../build/cli.md). <!-- id:E_bZFoJN -->

## SDK <!-- id:cNTmTt9P -->

The Explorer is a small example of building on the [SDK](../build/sdk.md)'s `createSeedClient` with `@shm/shared` React Query models on top. <!-- id:j3EtADEo -->

## Web API <!-- id:sT_4Cxsu -->

Everything the Explorer shows comes from `/api/<Key>` on the configured host; the API lab is the interactive way to learn those keys. <!-- id:1t6o_qj7 -->

## Agents <!-- id:U8BsP4ZH -->

Agents do not use the Explorer. An agent reads the same data with its `read` verb or through the [CLI](./cli.md). Explorer URLs are still a convenient thing to hand a person when an agent reports what it found. <!-- id:yelCJZGK -->

# See also <!-- id:tvQxRhhJ -->

- [The web app](./web.md), [The web API](../build/web-api.md), [URLs](../protocol/urls.md) <!-- id:TTdvJWTD -->
- [Blobs](../protocol/blobs.md), [Documents](../protocol/documents.md) <!-- id:Ns-M-wZD -->
