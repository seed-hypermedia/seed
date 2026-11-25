---
name: Spaces and Paths
summary: A space is all the documents that one account key owns, and this page covers paths, the home document, directories and the path rules that clients follow.
---
A **space** is the set of [documents](./documents.md) that one [account](./identity.md) owns. Every address in it has the form `hm://<account>/<path>`. For example, `hm://z6Mk…/notes/sushi` is the document at the path `/notes/sushi` in the space of the account `z6Mk…`. The account and the space are the same key seen from two sides: the identity that signs, and the place where its documents live.

This page explains how documents are named inside a space.

# Spaces, paths and the home document <!-- id:ulfSQIwk -->

Every address is `hm://<space>/<path>`. The home document is the address with an empty path. <!-- id:fIFnjBkC -->

Paths are plain strings. `/cars` and `/cars/honda` are two independent documents, and the [daemon](../software/daemon.md) keeps no tree of documents. A **directory** listing is a query for all addresses that start with a path. A parent gets no authority over its children from the path alone. There are two exceptions:

- [Capabilities](./permissions.md) apply by path segment. A grant at `/a` covers `/a/b` and does not cover `/ab`.
- Typed documents apply their `childAttributesSchema` to children by path; see [Typed documents](../schema/typed-documents.md).

Clients follow these path rules: <!-- id:30WkfDUD -->

- A path starts with `/` and does not end with `/`. It may not contain single or double quotes, backslashes, NUL, tab, CR or LF. The daemon rejects any [Ref](../ref.md) that breaks these rules.
- The daemon reads a path that is a single segment decoding as a [TSID](./blobs.md) (14 or 15 base58 characters) as a [comment](./comments.md) or contact record.
- A [private document](./privacy.md) must use a single path segment.
- The apps use a leading `-` for local draft paths.
- The apps refuse to publish a path that starts with `-`, `.` or `_`.

The exact path rules are in the `path` row of the [ref](../ref.md) type page. The first segments that a site reserves are in [URLs](./urls.md).

# The home document

The home document is the document at the empty path of a space, `hm://<account>`. Its first change, the genesis, is an empty Change with `ts` 0. Every device of the account computes the same one; see [Documents](./documents.md). A home document may not be deleted (a tombstone) and may not be a redirect. It can never be private. When the space is published as a [site](./sites.md), the home document names the web address in its `siteUrl` [metadata](../metadata.md) key.

The home document is separate from the [profile](../profile.md). The profile gives the account its name and picture. The home document gives the space its content.

# Directories

A directory is the set of documents whose paths sit under a given path. A query by path prefix finds them. The daemon stores no tree, so a directory is only a listing. A [query block](./blocks.md) shows such a listing inside a document, and the `/:directory` view suffix in [URLs](./urls.md) asks for one.

# Who may write in a space

By default only the key that owns the space can publish into it. The owner lets other keys write with [capabilities](./permissions.md), each limited to a path. Joining or following a space grants nothing; see [Contacts](./contacts.md).

# Working with spaces

```sh
seed-cli document create -f page.md -p /notes/sushi --name "Sushi"   # publish at a path in your space
seed-cli children <uid> -p /notes                                     # the documents one level under /notes
seed-cli query <uid> -p /notes -m AllDescendants                      # everything under /notes
seed-cli document get hm://<uid>/notes/:directory                     # the same listing as a document view
```

- **Seed app.** In the [Seed app](../software/desktop.md), the `/:directory` view of a document lists the documents under its path.
- **CLI.** The commands above are in [Seed CLI](../build/cli.md).
- **Seed API.** The `Query` request lists the documents of a space by path prefix, with a mode of `Children` or `AllDescendants`. See [Seed API](../build/web-api.md) and the [query](../query.md) type page.

# See also

- [Identity](./identity.md): the key behind a space.
- [Documents](./documents.md): Changes, Refs, versions and generations.
- [URLs](./urls.md): how a space and a path appear in a link.
- [Permissions](./permissions.md): who may publish at a path.
- [Sites](./sites.md): a space published at a web domain.
- [ref](../ref.md): the blob that places a document at a path.
