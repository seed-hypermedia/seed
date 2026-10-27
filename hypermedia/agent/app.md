---
name: App
summary: The page type of a Seed Agents app, whose attributes declare its slug, the arguments a mount takes, the grants it needs, the hosts its code reaches and how its usage is counted, and whose body is the skill doc the model reads.
---
An **app** for [Seed Agents](../agent.md) is a page of this type, with one [app-tool](./app-tool.md) page per tool under its `tools` folder. The page's [attributes](../schema/typed-documents.md) are the app's declaration: a `slug`, the `arguments` a mount takes (each with a kind, whether it is secret, whether it is required), the `permissions` its tools need, the `network` hosts its code may reach, and a `usage` block that says how the server counts what the app consumes. Its body is the **skill doc**: the instructions the model reads before using the app, the way the [Agent Guide](./guide.md) explains the verbs.

The tools are not attributes. Each is a page of its own under the `tools` folder, typed by [app-tool](./app-tool.md) and carrying its contract and its code, so a tool is added to an app by publishing one more page there. A space installs an app by publishing an [app-mount](./app-mount.md) page that names this page, or by publishing a copy of this page with its `mount` attributes set. An agents server that finds either in a space it serves reads the app, validates it against this type, and projects its tools, code and all, as tool documents for the agents of that space; the code runs in the server's sandbox with exactly the hosts named here, and with the mount's arguments.

An example, the [Datalab converter](./apps/convert.md):

```yaml
---
name: Datalab converter
summary: Converts PDFs, office documents, EPUBs and images from agent memory into reviewable markdown.
attributesSchema: hm://hyper.media/agent/app
slug: convert
arguments:
  apiKey: {type: string, secret: true, required: true, order: 1, description: A Datalab API key.}
  mode: {type: string, order: 2, choices: {fast: Fast, balanced: Balanced, accurate: Accurate}}
network: {datalab: www.datalab.to}
usage: {meter: per-unit, unit: pages, period: month, callCap: 200}
---
```

A list of arguments is a map keyed by argument name, a set of grants is a map of flags, and the hosts are a map keyed by a label, because a document's attributes hold scalars and nested maps and never lists, and a map key cannot contain a dot. A secret argument is declared here and provided to the agents server when the app is mounted; it is never written into a document. What a server-wide mount of a metered app gives away, the allowance per space and the ceiling for the server, is set on the [mount page](./app-mount.md), not here; `callCap` bounds what one call may spend.

This page describes the **agent/app** type. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type.

# See also

- [app-tool](./app-tool.md): the type of each tool under the app's `tools` folder.
- [app-mount](./app-mount.md): how a space installs an app authored elsewhere.
- [Apps](./apps.md): the apps Seed publishes.
- [Agent apps](./agent-apps.md): how an app is found, mounted and run.
- [Typed documents](../schema/typed-documents.md): how a page names its type and a folder types its children.
