---
name: Spaces and Paths
summary: A space is the namespace of documents that one account key owns, and this page covers paths, the home document, directories and the path conventions that clients follow.
---
A **space** is the namespace of [documents](./documents.md) that an [account](./identity.md) owns. Its addresses have the form `hm://<account>/<path>`. Account and space are the same key seen from two sides: the identity that signs, and the place its documents live. This page explains how documents are named inside a space.

# Spaces, paths and the home document <!-- id:ulfSQIwk -->

A **space** is a public [key](./identity.md). Every address is `hm://<space>/<path>`, and the home document is the address with an empty path. Paths are plain strings. `/cars` and `/cars/honda` are two independent documents, and the daemon keeps no tree of documents. A **directory** listing is a prefix query over addresses. A parent gets no authority over its children from the path alone. There are two exceptions. [Capabilities](./permissions.md) apply by path segment: a grant at `/a` covers `/a/b` and does not cover `/ab`. Typed documents apply their `childAttributesSchema` to children by path; see [Typed documents](../schema/typed-documents.md). <!-- id:fIFnjBkC -->

Two path conventions matter to clients. The daemon reads a path that is a single segment decoding as a [TSID](./blobs.md) (14 or 15 base58 characters) as a comment or contact record. A [private document](./privacy.md) must use a single path segment. The apps also use a leading `-` for local draft paths, and refuse to publish a path that starts with `-`, `.` or `_`. <!-- id:30WkfDUD -->

The exact path rules are in the `path` row of the [ref](../ref.md) type page, and the first segments a site reserves are in [URLs](./urls.md).

# The home document

The home document is the document at the empty path of a space, `hm://<account>`. Its genesis is a deterministic empty Change with `ts` 0, so every device of the account derives the same one; see [Documents](./documents.md). A home document may be neither a tombstone nor a redirect, and it can never be private. When the space is published as a [site](./sites.md), the home document names the web address in its `siteUrl` [metadata](../metadata.md) key.

The home document is separate from the [profile](../profile.md). The profile gives the account its name and picture. The home document gives the space its content.

# Directories

A directory is the set of documents whose paths sit under a given path, found by a prefix query. The daemon stores no tree, so a directory is only a listing. A [query block](./blocks.md) shows such a listing inside a document, and the `/:directory` view suffix in [URLs](./urls.md) asks for one.

# Who may write in a space

By default only the key that owns the space can publish into it. The owner lets other keys write with [capabilities](./permissions.md), scoped by path. Joining or following a space grants nothing; see [Contacts](./contacts.md).

# See also

- [Identity](./identity.md): the key behind a space.
- [Documents](./documents.md): Changes, Refs, versions and generations.
- [URLs](./urls.md): how a space and a path appear in a link.
- [Permissions](./permissions.md): who may publish at a path.
- [Sites](./sites.md): a space published at a web domain.
- [ref](../ref.md): the blob that places a document at a path.
