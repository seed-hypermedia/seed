---
name: Character
summary: "A world-builder kit type: a page about a character. Extends the base document; its metadata requires a `born` date and a `role`, and links the character to a ho"
schemaDefinition: ipfs://bafyreibuzqvotme3rl4f5tlwxu6srjtkexujkbfy6hwm5vbsuzkkxvutoi
---
A world-builder kit type: a page about a character. Extends the base document; its metadata requires a `born` date and a `role`, and links the character to a home place, a faction, a portrait file, and a stats object (an `ipfs://` object that must conform to `example-stats`). `notes` is an untyped object link — any DAG-CBOR value. <!-- id:QPklbVhv -->

This document describes the **example-character-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:r80voeuc -->