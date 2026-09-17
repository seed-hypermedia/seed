---
name: Examples
summary: A catalog of all 37 example schemas and instances in the Hypermedia Schemas library, grouped by the feature each one shows.
---
# Examples <!-- id:HKSIPG2Z -->

Every example here is built with [Hypermedia Schemas](./schema.md) and published as its own page under `example/`, with the schema beside it as `example/<name>.schema.json`. Each one shows one feature and links to the types it uses. The groups follow [Hypermedia Schemas in one page](./schema/quick-reference.md). Thirty-two are schemas, and five are instances: [documents](./protocol/documents.md) whose attributes are the data. <!-- id:-wxYRM0Q -->

## Structs <!-- id:oGPlvmvN -->

A [struct](./struct.md) is a [closed map](./schema/closed-map.md) with named fields, each marked required or optional. <!-- id:KEhxl7Mb -->
  - [address](./example/address.md) is three strings, `street` and `city` required and `postalCode` optional. <!-- id:Nacs_YWm -->
  - [geo](./example/geo.md) is `float` latitude and longitude with an optional `integer` altitude. <!-- id:g8yBWfUc -->
  - [person](./example/person.md) has a required `name`, an `integer` age, a `boolean` flag, a home that [includes](./schema/references.md) address, and a list of nicknames. <!-- id:nVLVzwuR -->
  - [employee](./example/employee.md) [extends](./schema/extension.md) person with a required `employeeId` and a `department`. <!-- id:ZnIPWts0 -->
  - [admin](./example/admin.md) extends employee with a map of `boolean` permission flags, a two-level chain from admin to employee to person. <!-- id:fQ7YGect -->
  - [stats](./example/stats.md) holds three integers bounded from 1 to 10, a literal-union alignment, and a list of traits. <!-- id:xIoq_9tG -->
  - [constrained](./example/constrained.md) shows value constraints: a username with `minLength`, `maxLength` and `pattern`, a score between 0 and 100, and a list of one to three tags. <!-- id:PYfnvrw0 -->
  - [blob](./example/blob.md) is a `bytes` payload with a required mime string and an optional size. <!-- id:C-1sn3aB -->
  - [article](./example/article.md) pulls the others together: a status union, an author `Link<person>`, tags, a `bytes` body, a word count, a cover `Link<blob>`, a list of comment links, and open string metadata. <!-- id:iZHzPdc_ -->

## Maps and lists <!-- id:Litrltyz -->

A [list](./list.md) constrains its `items`. An open [map](./map.md) constrains its `values`. See [the schema language](./schema/schema-language.md). <!-- id:RJooBqNV -->
  - [counts](./example/counts.md) is `Map<Integer>`, the worked example. <!-- id:B35K3M5Y -->
  - [tags](./example/tags.md) is `List<String>`. <!-- id:ADxHncd4 -->
  - [matrix](./example/matrix.md) is `List<List<Integer>>`, a nested list. <!-- id:ZFp9DXan -->
  - [metadata](./example/metadata.md) is `Map<String>`, an open map of strings. <!-- id:37dvuu1i -->
  - [registry](./example/registry.md) is `Map<Link<person>>`, a map whose values are typed [links](./link.md). <!-- id:pCrPxAmI -->
  - [tree](./example/tree.md) is a node with an integer value and a list of links to child trees. <!-- id:XQAu127V -->
  - [json](./example/json.md) is a recursive union: a JSON value is null, a boolean, an integer, a float, a string, a list of JSON values, or a map of JSON values. <!-- id:EUKbD7wt -->

## Unions and literals <!-- id:TRiT5pPB -->

A [union](./schema/anyof.md) accepts a value that matches any one of its variants. A bare [literal](./schema/literal-schema.md) accepts exactly one value, so a union of literals is a fixed set of choices. <!-- id:BIvxHvFy -->
  - [status](./example/status.md) is the union of three literals, `draft`, `published` and `archived`. <!-- id:25xmLnuT -->
  - [value](./example/value.md) is `anyOf` string, integer, boolean or null. <!-- id:Ml4Hpn53 -->
  - [entry](./example/entry.md) is a filesystem entry: a folder or a file. <!-- id:SMzNJ2fD -->

## Recursion <!-- id:ngPnGEkV -->

These work because schemas reference each other by name, as an [hm:// URL](./protocol/urls.md). A content hash cannot point at itself, so a hash-based reference could not form a cycle. [References](./schema/references.md) and [the fixpoint problem](./schema/fixpoint-problem.md) explain why. <!-- id:yZkCj7Y4 -->
  - [document](./example/document.md) refers to itself: `previous` links to another document. <!-- id:ymvJqId7 -->
  - [comment](./example/comment.md) is a thread, because a comment's `replies` link to comments. <!-- id:aojXrSvY -->
  - [folder](./example/folder.md) and [file](./example/file.md) are mutually recursive: a folder lists files and subfolders, and a file links back to its parent folder. <!-- id:2ekiJzl0 -->

## A custom block and a custom Change <!-- id:_Zyt3Gct -->

These show how an application adds its own [block](./protocol/blocks.md) type and constrains the changes it accepts. <!-- id:Z-Hy4tVq -->
  - [poll-block](./example/poll-block.md) extends [block/base](./block/base.md) with the type literal `Poll`, a required question, a required list of options, and attributes such as `multiple`. <!-- id:pMVIhymw -->
  - [app-block](./example/app-block.md) is the union of the [core blocks](./block/core.md) and poll-block: every block this application understands. <!-- id:Rs7UzOC5 -->
  - [myapp-change](./example/myapp-change.md) instantiates the [generic](./schema/generic.md) [change](./change.md) with `Block` set to app-block, so a change carrying an unknown block type is rejected deep inside its ops. <!-- id:2H2Gp4Tg -->

## Attributes schemas for typed documents <!-- id:5sNzM3wJ -->

An attributes schema is a plain struct of the fields a document's [metadata](./metadata.md) carries. A document names it with `attributesSchema`, and a folder names it for its children with `childAttributesSchema`. See [typed documents](./schema/typed-documents.md). <!-- id:Rj_hZP7M -->
  - [person-doc](./example/person-doc.md) is a required `surname` and an optional `givenName`. <!-- id:0kQ0dPm5 -->
  - [world-doc](./example/world-doc.md) is a genre chosen from five literals, an epoch date and a tagline. It types the page at the root of [the World Builder](./schema/world-builder.md). <!-- id:-HbeKOjb -->
  - [character-doc](./example/character-doc.md) has birth and death dates, a role, `hm://` links to a home place and a faction, and `ipfs://` links to a portrait, stats and notes. <!-- id:mUSezYPg -->
  - [place-doc](./example/place-doc.md) has a kind, a founding date, links to a containing region and a ruling faction, and `ipfs://` links to geo coordinates and a map. <!-- id:YFU2iKYe -->
  - [faction-doc](./example/faction-doc.md) has founding and dissolution dates, links to a seat and a leader, and an `ipfs://` link to a banner. <!-- id:c2vbnh8t -->
  - [event-doc](./example/event-doc.md) has start and end dates, links to a location, a protagonist and a faction, and an outcome. <!-- id:9dMo5tyY -->

## Instances <!-- id:xxv3d5ho -->

An instance is an ordinary typed document: its own attributes are the data, and its `attributesSchema` names the type they follow. Open one in the Seed app and its Attributes tab checks the data against the type. <!-- id:QS_X-Qc7 -->
  - [alice](./example/alice.md) and [carol](./example/carol.md) are people, instances of person. <!-- id:s7bGoabh -->
  - [bob](./example/bob.md) and [dave](./example/dave.md) are employees, instances of employee. <!-- id:i37qO0Qw -->
  - [root](./example/root.md) is an admin, an instance of admin, which is itself two levels of extension. <!-- id:9HYSH6eG -->

Every schema and instance page lists what it depends on and what depends on it. From person you can reach its dependents, employee plus alice and carol. From bob you can walk up to employee and person. <!-- id:3m3eZzyL -->

# Checking the examples <!-- id:jzou-HMh -->

From a checkout of the Seed repository, the reference validator checks every example schema against the [meta-schema](./schema.md) and runs accepting and rejecting data cases for many of them. <!-- id:yOWgEY01 -->

```sh <!-- id:mwZwb8nz -->
node scripts/hypermedia/validate.mjs
```

To check your own data file against one of these schemas, name the schema and the file. <!-- id:JNwDHyeL -->

```sh <!-- id:wqTx5NHe -->
node scripts/hypermedia/validate.mjs example/article my-article.json
```

The [Seed CLI](./build/cli.md) also checks data against a published type: <!-- id:hE1GrTtd -->

```sh
seed-cli blob validate -f value.json --schema <type URL>
```

# See also

- [Hypermedia Schemas](./schema.md): the schema system.
- [Hypermedia Schemas in one page](./schema/quick-reference.md): the features these examples follow.
- [Typed documents](./schema/typed-documents.md): attributes schemas on real pages.
- [The World Builder](./schema/world-builder.md): the demo behind the world-builder types.
- [Seed API Schemas](./rpc.md): real schemas for the Seed API.
