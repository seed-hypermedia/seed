---
name: Agent Apps
summary: The design of apps for Seed Agents, where an app is a typed Seed document whose tools carry their own code, a space installs it by publishing a page, and the server that acts on it proves the space is bound to it and runs the code in its sandbox, with the first two iterations shipped and the later phases laid out.
---
Written 2026-10-25 from a whiteboard session, alongside the first iteration; revised 2026-10-26 when the second moved the code into the pages, and 2026-10-27 when a tool's contract and code moved from its body into its attributes. What shipped is reference material on the [agent apps](../agent-apps.md) page, with a summary below. The rest of this page records the whole model the whiteboard sketched and proposes the phases that follow. Status as of 2026-10-27: code-carrying tools implemented, later phases proposed.

# The model

An **app** is what a space installs to give its agents a capability: a document converter, a connector to an external system, a workflow with its schedule. The whiteboard named five things and this design keeps the names.

**App page.** The home page of an app, typed [app](../app.md). The whiteboard called it the app page; one name is enough, and it is the app. Its attributes declare a `slug`, the `arguments` a mount takes (each with a kind, whether it is secret and whether it is required), the `permissions` its tools need, the `network` hosts its code may reach, and a `usage` block saying how the server counts what the app consumes. Its body is the **skill doc**, the instructions the model reads before using the app. Everything an app is lives in documents, so an app is published, versioned, linked and read like any other page.

**Tool.** One tool of an app, typed [app-tool](../app-tool.md), a page under the app page's `tools` folder (the folder types its children, so a tool is added by publishing one more page). Its attributes name the tool, summarize it, say what language its code is in, and carry the contract (`inputSchema`, `outputSchema`) and the code; its body is the tool's documentation, the instructions the model reads. There is one kind of tool: a page with code, run on the server for the spaces that mounted the app, in the sandbox the `execute` tool uses, with the mount's arguments and exactly the hosts the app declares. The first iteration bound tools to executors compiled into the server instead, with the converter's own logic in server code; that was wrong, and it is gone.

**Mount** (the whiteboard's app instance). An app installed for a space on an agents server. A space mounts an app by publishing a page typed [app-mount](../app-mount.md) that links the app's page (the reference form), or by publishing a copy of that page with its `mount` attributes set (the copy form, for an app the space authors itself). A mount has a scope: `space`, or `server` for every space the server serves, honored only in the operator's space. The person never touches the server to mount: they publish a page, and the server finds it. The mount is also the consent: the Apps dialog says what the app's code gets before the page is published, and pins the app page's version.

**Schedule** and **page** (view). An app will be able to declare triggers its mount creates (a schedule, a webhook) and views (HTML and JavaScript shown in the app, talking to the agents API over postMessage). Neither is built yet; see the phases.

**Connector.** An app whose tools implement another app's tool contracts, so an app can be written against "a CRM" and a space picks the Salesforce or the HubSpot connector. Not built yet.

# Why typed documents and not a manifest

Document attributes hold strings, integers, booleans and null, nested as key paths, and a schema types exactly that. So a list is a map (a set of flags, a map of argument declarations keyed by name, a map of hosts keyed by a label) or a set of child documents (the tools), the way the schema library models its own examples. The three schemas live in the library, so they are bundled into the SDK with generated types, the server validates an app page without a fetch, the library checker validates the instance pages in the repo, the editor renders the right forms, and the daemon finds instances by type. A manifest in a code block would have had none of that.

The tool's contract and code are attributes too: `inputSchema` and `outputSchema` hold a JSON Schema as text, because a JSON Schema needs lists (`required`, `enum`, `items`) that attributes cannot hold, and `code` holds the source. The body of a tool page is documentation and nothing else. Iteration 2 first put the three in the body under headings the server read by name; that had the server parse prose for structure the schema should declare, and the editor could not tell the code from an example. The schema declares them now, so the editor renders them as fields, the server reads them without parsing, and the body is the model's alone.

Discovery depends on one fix that shipped with iteration 1: the agents service's own publish path wrote a nested metadata map as a single value, which the daemon kept but never indexed, so agent-authored app pages would have been invisible to queries. It now writes leaf key paths, as the CLI sync always did.

# Who owns a mount: binding and proof

Three parties: a space, the site that serves it on the web, and an agents server. The protocol already ties the first two to each other by declarations only their owners can make: the space's home document names its site (`siteUrl`) and the site's `/hm/api/config` names the space. The agents server is tied the same way.

1. **A space names its agents server.** Its home document carries `agentServerUrl`, which the owner sets when choosing a server. If the space never set one, its site speaks for it: `<siteUrl>/hm/api/config` carries `agentServerUrl` too. So a `foo.hyper.media` subdomain is bound to the hosted server by its site unless its owner says otherwise, and a company running its own server is bound to that server by its home document or its own site's config.
2. **A server proves it is that URL.** Each agents server has an identity key and publishes its principal as `serverUid` in `/health`. When a server meets a URL in a binding it fetches that URL's `/health` and compares the `serverUid` it gets back with its own; only a match makes the URL "me". A server cannot claim a URL it does not answer at, exactly as a custom domain is proven by what DNS points at. No URL is configured anywhere.
3. **The operator's space** is the one registered on the site the server reads through, when the agents server that site advertises proves to be this one. A `scope: server` mount there applies to every space the server serves; anywhere else it is ignored. The hosted server reads through `hyper.media`, so Seed's own space mounts the subsidized Datalab converter for every tenant; a company's box reads through its own site and never sees Seed's mounts as its own.

A pass asks the daemon for every document of the two mount forms, resolves each space's binding, keeps what proves to be its own, reads and validates the app page and its tools (strictly: the daemon does not validate on publish), and stores a snapshot, code included. Projection and execution never read the network. The pass runs every five minutes and on demand from the Apps dialog. Watching the activity feed for new mount pages instead of polling is a later phase.

# Trust, secrets and usage

An app's code runs in the microVM the space already trusts with model-written code, under the agent's own principal, with only the mount's arguments and the declared hosts added: the arguments arrive in the process environment, never in the program text; egress is an allowlist of the app's hosts, or nothing; a metered tool gets a budget. So no new policy decides which spaces may mount code: whoever can publish the mount page consents, and the dialog shows what to. An app's tool needs no `execute` grant, since the agent cannot write the code, and it runs under a sandbox principal of its own so a pooled VM never carries a secret into model-written code.

A secret argument is declared on the app page and provided on the server, through the Apps dialog, under `app-<slug>-<arg>`; a mount document that writes one is refused. A server-scope secret comes from the server's environment, `SEED_AGENTS_APP_<SLUG>_<ARG>`.

The app page declares its usage model and the operator's server-wide mount page sets what is given away (the allowance per space and the ceiling for the server), so the ledger is generic: the server reserves a call's budget before the run, the tool reports what it spent, the server settles. The Apps dialog shows pages used and left and says that mounting the app with an own key lifts the cap. That is the freemium funnel, declared by the app and enforced by the ledger.

# What shipped

**Iteration 1 (2026-10-25).** The three schemas and their pages; the metadata key-path fix; detection with binding and proof; the server identity key and `serverUid`; snapshots in `app_mounts`; projection of tools as tool documents; the signed actions `ListApps`, `RefreshApps` and `GetAppUsage`; the Apps dialog with the apps the node knows and a Mount button that starts the mount page as a pre-filled draft; app tools as rows in the Tools tab, with the catalog under them. Its tools bound to server executors, and the converter was server code with a relay for keyless servers.

**Iteration 2 (2026-10-26).** The tool page carries its contract and its code, and the server runs it: the sandbox takes an environment, an egress allowlist and a longer timeout; app tools project as lambdas and run through the same path as authored ones, with the mount's context; the ledger meters any app, with the allowance and ceiling on the operator's mount page; the Datalab converter is two pages, its tool page holding the Datalab client, the output tree, the caption folding and the citation links, and the server ships no converter, no Datalab flags and no relay (the desktop's embedded server, the relay's only reason, is legacy). The Apps dialog says what an app's code gets and pins the app page's version when mounting. On 2026-10-27 the contract and the code moved from the page body, where the server read them under headings, into the attributes `inputSchema`, `outputSchema` and `code`, and the body became documentation.

# Phases

## Connectors

A tool bound to another app's tool contract promises to implement it. A space mounts the app and a connector that implements its contracts, and the server routes calls by contract. The contract is the tool's input and output schemas, which tool pages now carry.

## Schedules

An app declares triggers its mount should create (a weekly run, a webhook). `agent_triggers` has no owner column, so the server cannot yet tell its own rows from a person's; add `owner_kind`/`owner_ref` and create, replace and remove trigger rows with the mount.

## Pages

An app declares views: HTML and JavaScript the app shows in a sandboxed iframe, talking to the agents API over postMessage with the viewer's identity. Needs the embedding contract and the capability the page acts with.

## Smaller follow-ups

Event-driven detection through the activity feed. The Mount button on the web, which has no typed-draft flow yet. Spaces bound to several agents servers (a `server` field on the mount, proven the same way). An "update available" line on a mount pinned behind the app page's latest version, with a diff of the code. A tool editor in the Apps dialog. A domain-admin page on the web site. The sandbox SDK can keep a secret out of the guest entirely (`secretEnv`, substituted only in requests to an allowed host); the environment variable is the simpler model until a tool needs that. A smaller VM profile for app runs, which mostly wait on a remote service.

# Non-goals

A marketplace or ranking of apps; the pages where apps are found are ordinary pages, found by type. Running an app's code outside the execute sandbox. Mounting without publishing. A relay for servers that have no key: the hosted server runs the code for the spaces bound to it, and a server of one's own needs a key of one's own.

# Open questions

- Who may store app secrets: the owner only, or any WRITER of the space, as `SetSecret` allows today.
- Whether `RefreshApps` should be reader-level so a collaborator can nudge detection.
- Whether a site's `/hm/api/config` binding should be enough on its own, or whether the Apps dialog should write `agentServerUrl` into the home document so the owner's choice is explicit.
- Whether a child that carries its own `attributesSchema` under a typed folder should satisfy both, as the typed-documents page says and `effectiveSchemaRef` does not yet do.
- Map keys cannot contain dots, so nothing in the schemas can be keyed by URL; hosts are keyed by a label for that reason.
- Whether new agents should be granted a space's app tools by default; today an app's tool is granted per agent in the Tools tab, by its own name.

# See also

- [Agent apps](../agent-apps.md): what shipped, as reference.
- [app](../app.md), [app-tool](../app-tool.md), [app-mount](../app-mount.md): the types.
- [Datalab converter](../apps/convert.md): the first app.
- [Sites](../../protocol/sites.md): the site handshake the binding copies.
- [Typed documents](../../schema/typed-documents.md): how a page names its type.
