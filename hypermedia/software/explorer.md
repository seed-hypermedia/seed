---
name: The Explorer
summary: The Hypermedia Explorer is a web page at explore.hyper.media that shows the raw data behind any hm:// or ipfs:// URL, follows the activity feed, and lets you try Seed API requests against a site.
---
The Hypermedia Explorer is a web page that shows the raw data on the [network](../protocol/network.md). Developers and operators use it to see what a [daemon](./daemon.md) really holds. The public copy is at `https://explore.hyper.media`. <!-- id:JjrZGIrW -->

Paste an [`hm://` URL](../protocol/urls.md), an `ipfs://` [CID](../cid.md) or the web address of a Seed page. The Explorer shows the resource as data: the [document](../protocol/documents.md)'s [metadata](../metadata.md) and [blocks](../protocol/blocks.md), its [change](../change.md) history, its [comments](../protocol/comments.md), [citations](../protocol/links-and-citations.md) and [capabilities](../protocol/permissions.md), and its child documents.

It also does four other things:

- It lists the root documents the network knows.
- It follows the activity feed.
- It decodes any [blob](../protocol/blobs.md).
- It has an API lab, where you try [Seed API](../build/web-api.md) requests by hand.

# Where the code is <!-- id:2mrFrRrq -->

The code is in `frontend/apps/explore`, package `@shm/explore`. It is a static single-page app built with Vite, React, react-router and Tailwind. It has no server of its own. It uses `@seed-hypermedia/client` (the [SDK](../build/sdk.md)), `@shm/shared` and `@shm/ui` straight from source through Vite aliases. [The shared packages](./packages.md) describes them. <!-- id:13Wpb7G9 -->

<!-- id:vCOhad9J -->
| Path <!-- col:wB1tGoGq --> | What it holds <!-- col:bh0y_tLr --> <!-- id:K_i673lS --> |
| --- | --- |
| `src/main.tsx`, `src/App.tsx` | Entry point and routes. <!-- id:HHwCMhVW --> |
| `src/universal-client.ts` | The data layer: a web universal client whose requests go to the configured API host. <!-- id:mZ3icQDV --> |
| `src/queryClient.ts`, `src/apiHostStore.ts` | The API host setting. <!-- id:qnCswXnI --> |
| `src/components/HM.tsx`, `src/components/tabs/` | The resource view and its tabs. <!-- id:hFFjlt9- --> |
| `src/components/IPFS.tsx` | The blob view. <!-- id:XGjbwh9- --> |
| `src/components/ApiLab.tsx`, `src/api-lab.ts` | The API lab; the logic lives in `@shm/shared/api-lab`. <!-- id:TYXq7JHM --> |
| `src/components/Feed.tsx`, `src/components/List.tsx` | The activity feed and the list of root documents. <!-- id:FXn96u3Z --> |

The app is part of the pnpm workspace. <!-- id:VDF0zMgg -->

# How it talks to the daemon <!-- id:5oTlo2Be -->

The Explorer never talks to a daemon directly. It talks to the [Seed API](../build/web-api.md) of a Seed [web app](./web.md). Every request is `createSeedClient(apiHost).request(key, input)`. So the Explorer shows exactly what the daemon of that [site](../protocol/sites.md) can see. The API host setting chooses the site. [Configuration](#configuration) describes it. <!-- id:zeeFqNUm -->

You can point the Explorer at three kinds of host: <!-- id:acTWcDqX -->

- A local web app, to inspect your development node.
- `https://hyper.media`, to see what the [gateway](../protocol/sites.md) sees.
- Any site, to see what that site's daemon has [synced](../protocol/network.md).

The same resource can look different on two hosts. That difference often answers a sync question.

# Configuration

- **API host.** It defaults to `VITE_PUBLIC_EXPLORE_API_HOST`, or `http://localhost:3000` when that is not set at build time. You can change it in the settings panel behind the gear icon. The choice is saved in the browser's `localStorage`.
- **`VITE_SEED_WEB_ORIGIN`.** When set at build time, the blob view links to that [web app](./web.md)'s inspector for editing.

# What it shows <!-- id:VmDDbnlS -->

<!-- id:dvNfTV52 -->
| Route <!-- col:s3u4Av3M --> | View <!-- col:XUNvTTnU --> <!-- id:uMX2M_2- --> |
| --- | --- |
| `/` | A search box for `hm://`, `ipfs://` and `https://` URLs of Hypermedia documents. <!-- id:t0VyRmc9 --> |
| `/hm/<account>/<path>` | A resource. Tabs, each with a count, cover the document, changes, comments, citations, capabilities, child documents, comments the [account](../protocol/identity.md) wrote, the [profile](../profile.md), and a comment's versions. [View terms](../protocol/urls.md) such as `/:comments` select a tab, the same way they do in the [web app](./web.md). <!-- id:QsdTr7YK --> |
| `/ipfs/<cid>` | A decoded blob. The signer [principals](../principal.md) are shown as `hm://` links, and there are copy and download buttons. The view knows [schemas](../schema.md): it recognises a schema blob, and it checks a blob that names a schema against that schema. <!-- id:QB0F4jaY --> |
| `/list` | The root documents the host knows. <!-- id:LiagHAj4 --> |
| `/feed` | The activity feed, paged, with the latest event. <!-- id:QhF7lnIg --> |
| `/api-lab` | The API lab. <!-- id:Mtg-vyVB --> |

When a resource is not found, deleted or redirected, the Explorer shows a status panel that names the state. This makes [tombstones and redirects](../ref.md) easy to see. <!-- id:Qn6hxrpk -->

# The API lab <!-- id:XV2kEdBG -->

The API lab is a place to try the [Seed API](../build/web-api.md) by hand. It works in four steps: <!-- id:aGx-5awQ -->

1. It loads `GET /api/schema` from the API host. The answer lists every request key with its kind (query or action), method and path.
2. You pick a key. The lab loads `GET /api/schema?key=<Key>`, the JSON Schema of that key's input and output.
3. The lab writes a first payload for you and shows the exact HTTP request it will send, with the query string or the CBOR body.
4. It sends the request and shows the result.

The [desktop app](./desktop.md)'s API bridge and every [web app](./web.md) serve the same schema route, so the lab works against both. [Seed API](../build/web-api.md) documents the same keys.

# Running it <!-- id:jFROeEL8 -->

```sh <!-- id:P69GGENR -->
pnpm explore                     # Vite dev server on :5173, reading from the web app on :3000
pnpm explore:build               # static build in frontend/apps/explore/dist
pnpm --filter @shm/explore test
```

`./dev up` starts it as the `explore` pane beside the [web app](./web.md) it reads from. The build is a folder of static files that any web host can serve. The hosted copy at explore.hyper.media reads from hyper.media. This repository does not define how that copy is deployed. <!-- id:uTlsb0It -->

# Working with it <!-- id:zc2FKEX8 -->

## In the Seed app <!-- id:iZHAQiOE -->

The [desktop app](./desktop.md) has its own tools for the same purpose: the blob editor and the metadata editor. The Explorer covers the reading part in any browser, against any [site](../protocol/sites.md). <!-- id:v0S31DxT -->

## CLI <!-- id:nmonk-1f -->

`seed-cli document get`, `seed-cli blob` and `seed-cli activity` read the same data from a terminal. Use `--json` to get what the Explorer shows. See the [CLI reference](../build/cli.md). <!-- id:E_bZFoJN -->

## SDK <!-- id:cNTmTt9P -->

The Explorer is a small example of an app built on the [SDK](../build/sdk.md)'s `createSeedClient`, with the React Query models of `@shm/shared` on top. <!-- id:j3EtADEo -->

## Seed API <!-- id:sT_4Cxsu -->

Everything the Explorer shows comes from `/api/<Key>` on the API host. The API lab is the way to learn those keys by trying them. [Seed API](../build/web-api.md) documents them. <!-- id:1t6o_qj7 -->

## Agents <!-- id:U8BsP4ZH -->

[Seed Agents](../agent.md) do not use the Explorer. A Seed Agent reads the same data with its [`read`](../agent/read.md) verb, and a coding agent reads it through the [CLI](./cli.md). An Explorer URL is still a useful thing to give a person when an agent reports what it found. <!-- id:yelCJZGK -->

# See also <!-- id:tvQxRhhJ -->

- [The web app](./web.md), [Seed API](../build/web-api.md), [URLs](../protocol/urls.md) <!-- id:TTdvJWTD -->
- [Blobs](../protocol/blobs.md), [Documents](../protocol/documents.md), [CLI reference](../build/cli.md), [The desktop app](./desktop.md) <!-- id:Ns-M-wZD -->
