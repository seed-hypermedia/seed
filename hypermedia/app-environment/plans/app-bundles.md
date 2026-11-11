---
name: Agent Apps
summary: The design of apps for Seed Agents, where an app is a typed Seed document whose tools carry their own code, a space installs it by publishing a page, and the server that acts on it proves the space is bound to it and runs the code in its sandbox, with the first two iterations shipped and the later phases laid out.
---
Written 2026-10-25 from a whiteboard session, alongside the first iteration; revised 2026-10-26 when the second moved the code into the pages, and 2026-10-27 when a tool's contract and code moved from its body into its attributes. What shipped is reference material on the [agent apps](../agent-apps.md) page, with a summary below. The rest of this page records the whole model the whiteboard sketched and proposes the phases that follow. Status as of 2026-10-27: code-carrying tools implemented, later phases proposed.

# The model

**App** is the generic noun of the Seed App Environment, and an agent is an app: the kind that has a model, a prompt, a memory and sessions. The computer is the analogy the team settled on (2026-11-11). An app is a program. Its tools are its commands, with a contract and code; a [custom page](../../apps/document-pages.md) is its window; a schedule is its cron entry; a connector is one program scripting another. A space installs a program, for one account or for every account the environment serves, and the people and the agents of the space run it. An agent is a program with a model that runs in a session with an identity of its own, which is why both can sign content in Seed. What the whiteboard named, this design keeps:

**App page.** The home page of an app, typed [app](../../app.md). Its attributes declare a `slug`, the `arguments` an install takes (each with a kind, whether it is secret and whether it is required), the `permissions` its tools need, the `network` hosts its code may reach, and a `usage` block saying how the environment counts its consumption. Its body is the guide: what the app does, what its tools write, what to do before publishing their results. People read it rendered; agents read it as a skill doc.

**Tool.** One tool of an app, typed [app-tool](../../app-tool.md), a page under the app page's `tools` folder (the folder types its children, so a tool is added by publishing one more page). Its attributes name the tool, summarize it, say what language its code is in, and reference the contract (`inputSchema`, `outputSchema`) and the code as content ids; its body is the tool's documentation. The environment runs the code in its sandbox when a user calls the tool: an agent through its grants, or a person from the palette. The code runs as the caller, in the caller's workspace, with the install's arguments and secrets, and signs nothing; what it produces, the caller publishes.

**Install.** An app installed for a space on an app environment. A space installs an app by publishing a page typed [app-install](../../app-install.md) that links the app's page (the reference form), or by publishing a copy of that page with its `install` attributes set (the copy form, for an app the space authors itself). An install has a scope: `space`, or `server` for an install the environment's operator publishes in their own space for every space it serves, with a usage allowance. The install is also the consent: it pins the app's version, so what runs is what was consented. Installed means granted: the tools of every app installed for a space reach every agent of it, and an agent switches an app off on its permissions page (`disabledApps`). Agents are installed differently today: main adopts an agent into a space as a document, which the code calls a mount; the phase below makes the agent's definition an app page and the agent document its install, so one word serves both.

**Schedule** and **page** (view). An app will be able to declare triggers its install creates (a schedule, a webhook) and views (HTML and JavaScript shown in the app). Neither is built yet; see the phases.

**Connector.** An app whose tools implement another app's tool contracts, so an app can be written against "a CRM" and a space picks the Salesforce or the HubSpot connector. Not built yet.

# Why typed documents and not a manifest

Document attributes hold strings, integers, booleans and null, nested as key paths, and a schema types exactly that. So a list is a map (a set of flags, a map of argument declarations keyed by name, a map of hosts keyed by a label) or a set of child documents (the tools), the way the schema library models its own examples. The three schemas live in the library, so they are bundled into the SDK with generated types, the server validates an app page without a fetch, the library checker validates the instance pages in the repo, the editor renders the right forms, and the daemon finds instances by type. A manifest in a code block would have had none of that.

The tool's contract and code are attributes too, as references: `inputSchema` and `outputSchema` name DAG-CBOR objects holding a JSON Schema, because a JSON Schema needs lists (`required`, `enum`, `items`) that attributes cannot hold, and `code` names a file or a folder. References, not text, because an attribute's text is full-text indexed and copied into the structural index with every version, and a folder of code has no place in a string. The body of a tool page is documentation and nothing else. Iteration 2 first put the three in the body under headings the server read by name; that had the server parse prose for structure the schema should declare, and the editor could not tell the code from an example. The schema declares them now, so the editor renders them as fields, the server reads them without parsing, and the body is the model's alone.

Discovery depends on one fix that shipped with iteration 1: the agents service's own publish path wrote a nested metadata map as a single value, which the daemon kept but never indexed, so agent-authored app pages would have been invisible to queries. It now writes leaf key paths, as the CLI sync always did.

# Who owns a mount: binding and proof

Three parties: a space, the site that serves it on the web, and an app environment. The protocol already ties the first two to each other by declarations only their owners can make: the space's home document names its site (`siteUrl`) and the site's `/hm/api/config` names the space. The app environment is tied the same way.

1. **A space names its app environment.** Its home document carries `agentServerUrl`, which the owner sets when choosing a server. If the space never set one, its site speaks for it: `<siteUrl>/hm/api/config` carries `agentServerUrl` too. So a `foo.hyper.media` subdomain is bound to the hosted server by its site unless its owner says otherwise, and a company running its own server is bound to that server by its home document or its own site's config.
2. **A server proves it is that URL.** Each app environment has an identity key and publishes its principal as `serverUid` in `/health`. When a server meets a URL in a binding it fetches that URL's `/health` and compares the `serverUid` it gets back with its own; only a match makes the URL "me". A server cannot claim a URL it does not answer at, exactly as a custom domain is proven by what DNS points at. No URL is configured anywhere.
3. **The operator's space** is the one registered on the site the server reads through, when the app environment that site advertises proves to be this one. A `scope: server` install there applies to every space the server serves; anywhere else it is ignored. The hosted server reads through `hyper.media`, so Seed's own space installs the subsidized Datalab converter for every tenant; a company's box reads through its own site and never sees Seed's installs as its own.

A pass asks the daemon for every document of the two install forms, resolves each space's binding, keeps what proves to be its own, reads and validates the app page and its tools (strictly: the daemon does not validate on publish), and stores a snapshot, code included. Projection and execution never read the network. The pass runs every five minutes and on demand from the Apps dialog. Watching the activity feed for new mount pages instead of polling is a later phase.

# Trust, secrets and usage

An app's code runs in the microVM the space already trusts with model-written code, under the agent's own principal, with only the install's arguments and the declared hosts added: the arguments arrive in the process environment, never in the program text; egress is an allowlist of the app's hosts, or nothing; a metered tool gets a budget. So no new policy decides which spaces may install code: whoever can publish the install page consents, and the dialog shows what to. An app's tool needs no `execute` grant, since the agent cannot write the code, and it runs under a sandbox principal of its own so a pooled VM never carries a secret into model-written code.

A secret argument is declared on the app page and provided on the server, through the Apps dialog, under `app-<slug>-<arg>`; an install page that writes one is refused. A server-scope secret comes from the server's environment, `SEED_AGENTS_APP_<SLUG>_<ARG>`.

The app page declares its usage model and the operator's server-wide install page sets what is given away (the allowance per space and the ceiling for the server), so the ledger is generic: the server reserves a call's budget before the run, the tool reports what it spent, the server settles. The Apps dialog shows pages used and left and says that installing the app with an own key lifts the cap. That is the freemium funnel, declared by the app and enforced by the ledger.

# What shipped

**Iteration 1 (2026-10-25).** The three schemas and their pages; the metadata key-path fix; detection with binding and proof; the server identity key and `serverUid`; snapshots in `app_mounts`; projection of tools as tool documents; the signed actions `ListApps`, `RefreshApps` and `GetAppUsage`; the Apps dialog with the apps the node knows and an Install button that starts the install page as a pre-filled draft; app tools as rows in the Tools tab, with the catalog under them. Its tools bound to server executors, and the converter was server code with a relay for keyless servers.

**Iteration 2 (2026-10-26).** The tool page carries its contract and its code, and the server runs it: the sandbox takes an environment, an egress allowlist and a longer timeout; app tools project as lambdas and run through the same path as authored ones, with the install's context; the ledger meters any app, with the allowance and ceiling on the operator's install page; the Datalab converter is two pages, its tool page holding the Datalab client, the output tree, the caption folding and the citation links, and the server ships no converter, no Datalab flags and no relay (the desktop's embedded server, the relay's only reason, is legacy). The Apps dialog says what an app's code gets and pins the app page's version when installing. On 2026-10-27 the contract and the code moved from the page body, where the server read them under headings, into the attributes `inputSchema`, `outputSchema` and `code`, and the body became documentation.

**Iteration 3 (2026-10-28).** The contract and the code became `ipfs://` references, as the demo review asked: the page carries content ids, the server fetches the code into a cache by CID at install and proves every file against it, the sandbox gets the files staged into a directory of their own, the Apps dialog links each tool's code and contract, the IPFS page lists a folder, and the docs sync publishes the files a page names by relative path (`code: ./convert.ts`) and writes them back when the app changes them. Open: uploading a folder from the attribute pill, and editing a folder in the app.

**Iteration 4 (2026-11-11).** The app environment rename, the word install, and the creation path. The app environment is the Seed App Environment: the source lives in `apps/`, the packages are `@seed-hypermedia/apps-protocol` and `apps-ui`, the image is built as `seedhypermedia/apps` (and still as `seedhypermedia/agents`), the API answers `/hm/api/apps` beside `/hm/api/agents`, the settings read `SEED_APPS_*` and still `SEED_AGENTS_*`, a space binds itself with `appEnvironmentUrl` and still with `agentServerUrl`, and the documentation moved here from `agent/` with redirects. Mount became install for apps, and the three types moved to the root of the library. Installed means granted, with the per-app switch. The Apps dialog opens from each environment's row in Settings and from an agent's permissions page. **New → App** publishes an app page with its typed tools folder. **Publish as app** turns an agent's own lambdas into an installed app, signed by the person, and removes the agent's copies. Agents read `~/tools/write/apps` before making work repeatable. Designed, not built: apps that sign, install-owned schedules, the agent as an app page, the app server split, the retirement of the old names.

# Phases

## Apps sign

An install gets a signing identity of its own, the way an agent has one, so a tool can publish as the app and a schedule can run as it. The identity is created with the install, owned by the installer, and granted what the app page declares. Until then a tool's output is published by its caller.

## Schedules

An install owns its schedules. The app page declares triggers (a weekly run, a webhook) and the install creates, replaces and removes them, which needs an owner on the trigger table (`owner_kind`, `owner_ref`) since today every trigger belongs to an agent. The environment already runs a trigger's `tool` and `script` continuations headlessly, with no model; what an install-owned run lacks is a workspace, since it has no agent memory to mount, so an install needs a workspace of its own or a tool that works on blobs alone.

## The agent as an app page

An agent's definition (prompt, model, grants, triggers) becomes a published app page, and the agent document in a space becomes its install, with the agent's memory and sessions as the install's state on the environment. New Agent then creates both, Publish as app covers the whole agent and not only its tools, and one install form serves apps with and without a model.

## Connectors

A tool bound to another app's tool contract promises to implement it. A space installs the app and a connector that implements its contracts, and the server routes calls by contract. The contract is the tool's input and output schemas, which tool pages carry.

## Pages

An app declares views: HTML and JavaScript the app shows in a sandboxed iframe, talking to the app environment's API over postMessage with the viewer's identity, the way a [custom page](../../apps/document-pages.md) already runs. Needs the embedding contract and the capability the page acts with.

## The app server

The environment runs agents and apps in one process. Splitting the app runtime (install detection, the code cache, the secrets, the usage ledger, tool execution) into a server of its own needs two things: a binding of the space to the app server, proven like the agents binding is, and a tool contract whose inputs and outputs are blobs, because today a tool reads and writes the caller's memory mounted at `/workspace`, which no second host can see.

## Retiring the old names

After the release that ships the rename: the compose files and the deploy script switch to the new image, path and settings names; published bindings name `appEnvironmentUrl` and `/hm/api/apps`; the hosted hostname's `agentic` aliases go once nothing names them; the old settings names stop being read.

## Smaller follow-ups

Event-driven detection through the activity feed. The Install button on the web, which has no typed-draft flow yet. Spaces bound to several environments (a `server` field on the install, proven the same way). An "update available" line on an install pinned behind the app page's latest version, with a diff of the code. A tool editor in the app. Folder upload from the attribute pill, and editing a tool's folder in the app.

# Non-goals

A marketplace or ranking of apps; the pages where apps are found are ordinary pages, found by type. Running an app's code outside the execute sandbox. Installing without publishing. A relay for servers that have no key: the hosted environment runs the code for the spaces bound to it, and an environment of one's own needs a key of one's own. An app that runs an agent of its own: a program that calls a model is still a program, and autonomy with an identity is an agent, installed as one.

# Open questions

- Who may store app secrets: the owner only, or any WRITER of the space, as `SetSecret` allows today.
- Whether `RefreshApps` should be reader-level so a collaborator can nudge detection.
- Whether a site's `/hm/api/config` binding should be enough on its own, or whether the Apps dialog should write `agentServerUrl` into the home document so the owner's choice is explicit.
- Whether a child that carries its own `attributesSchema` under a typed folder should satisfy both, as the typed-documents page says and `effectiveSchemaRef` does not yet do.
- Map keys cannot contain dots, so nothing in the schemas can be keyed by URL; hosts are keyed by a label for that reason.
- Resolved (2026-11-11): installed means granted, with a per-app switch on the agent's permissions page.
- When the agent becomes an app page, whether one install form (the app-install page) serves both kinds, and what the agent's adoption flow becomes.

# See also

- [Agent apps](../agent-apps.md): what shipped, as reference.
- [app](../../app.md), [app-tool](../../app-tool.md), [app-install](../../app-install.md): the types.
- [Datalab converter](../apps/convert.md): the first app.
- [Sites](../../protocol/sites.md): the site handshake the binding copies.
- [Typed documents](../../schema/typed-documents.md): how a page names its type.
