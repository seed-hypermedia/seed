# Hypermedia URLs

These URLs are used to address content in the Hypermedia protocol. The URL generally follows the format: `hm://[ACCOUNT_ID]/[PATH]?[PARAMETERS]`

## Protocol

Hypermedia URLs are always prefixed with the `hm://` protocol, so they may be distinguished from other URL types such as `https://` and `ipfs://`

## Account

The first term of the Hypermedia URL is the only required part: an [Account ID](./accounts.md#account-id).

A basic Hypermedia URL is `hm://z6MkjPVNrNGA6dYEqkspBvfuTnAddw7hrNc5WM6dQDyuKkY3` which refers to the [Home Document](./concepts.md#home-document) of this Account.

## Path

If the path is missing, the URL will refer to the Home Document of that account.

## Parameters

Optional query parameters to be specified after the `?` part of the hypermedia URL.

- `v` - Version
- `l` - Latest

### Version

This URL parameter will specify the lowest allowed version of the document.

The version is defined as a list of Change CIDs, where the CIDs may be concatenated with a `.` character if there is more than one.

### Latest

When this `?l` is specified, the reader should attempt to load the most recent version of the document.
