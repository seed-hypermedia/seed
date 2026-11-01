---
name: Apps
summary: The apps Seed publishes for Seed Agents, one page per app with its tools beneath it.
childAttributesSchema: hm://hyper.media/agent/app
---
Every page in this folder is an [app](./app.md): the home page of an app, whose attributes declare it and whose body is the skill doc the model reads. The folder types its children, so each page follows the app schema without saying so itself. An app's tools sit under its `tools` folder as [app-tool](./app-tool.md) pages, each carrying its contract and its code.

- [Datalab converter](./apps/convert.md): converts PDFs, office documents, EPUBs and images from agent memory into reviewable markdown.

# See also

- [app](./app.md): the type every page here follows.
- [app-mount](./app-mount.md): how a space installs one of these.
