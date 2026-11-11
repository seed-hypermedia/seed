---
name: App Install
summary: The page type a space publishes to install a Seed Agents app authored elsewhere, naming the app, the scope and the non-secret argument values.
---
An **app install** installs an [app](./app.md) for a space. The space's owner, or someone with a writer grant there, publishes a page typed by this schema, by convention at `/apps/<slug>`. Its `app` attribute is a typed link to the app's page: the value is an `hm://` URL, and the page it names must follow the app type, which is what the editor's picker for the field offers. `?v=` pins the version whose code the space saw and consented to, which is how the Apps dialog's Install button writes it; without a version the install follows the app's page as it changes, which suits an operator installing their own app.

`arguments` holds values for the app's non-secret arguments. A secret argument, such as an API key, never goes into a page: the person installing the app stores it on the agents server through the app, where it is encrypted and paired with the install by the app's slug. `scope` is `space` unless the page sits in the server operator's own space, where `server` installs the app for every space the server serves. On such an install of a metered app, `usage` says what is given away: the `allowance` each space may consume per period and the `ceiling` for the whole server, in the app's unit; a space install ignores it, since it spends the space's own key.

Which agents server acts on an install follows from the server the space is bound to, the one its home document names as `agentServerUrl`, or failing that the one its site advertises. The server finds install pages by their type, keeps the ones whose space is bound to it, reads and validates the app, projects its tools as tool documents for the space's agents and runs their code for them. Deleting the page, or setting `enabled: false`, uninstalls.

```yaml
---
name: Datalab converter
attributesSchema: hm://hyper.media/agent/app-install
app: hm://hyper.media/agent/apps/convert?v=<the app version installed>
scope: space
enabled: true
---
```

This page describes the **agent/app-install** type. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type.

# See also

- [app](./app.md): what an install installs.
- [Apps](./apps.md): the apps Seed publishes.
- [Typed documents](../schema/typed-documents.md): how a page names its type.
