---
name: Why Hypermedia
summary: The motivation behind the Hypermedia protocol, written for any reader, with one page per idea and a plain note on the limits today.
---
The web lets anyone publish, but it forgets. It cannot prove who wrote what. And it gives you only two ways to reuse someone else's work: a fragile link, or a copy that looks like theft. Hypermedia tries to fix these three problems in the protocol itself, with no company in the middle. <!-- id:L8-LA2xM -->

This section makes the case. You do not need to know what a hash is to read it. Every term links to the [glossary](./glossary.md), and every claim links to the page that explains how it works. The [protocol tour](./protocol.md) tells the same story in precise terms. <!-- id:gLY12IhF -->

# The ideas <!-- id:X5LmMDb3 -->

<!-- id:c-ajZqQH -->
- [The end of broken links](./why/broken-links.md). Read this to see why content is named by a hash of its bytes, and why a link keeps working as long as anyone holds a copy.
- [Signed content](./why/signed-content.md). Read this to see why authors sign on their own devices, and why Hypermedia is not built on ActivityPub.
- [Open editing](./why/open-editing.md). Read this for version history, branching into your own space, and the git model behind them.
- [A network for thought](./why/network-for-thought.md). Read this for what having no login means, what a node holds, and how the ordinary web fits in.
- [Inspirations](./why/inspirations.md). Read this for the earlier systems these ideas come from.

# What this is not <!-- id:ERXjT6ks -->

Hypermedia is not a social network, a blockchain, or a walled garden. It has no token and no global consensus, and you do not have to use the hosted servers. Seed, the software, is open source under the Apache license. The hosted [sites](./protocol/sites.md) at hyper.media are a convenience, and a site you host yourself is a full peer. <!-- id:1EzTuUVy -->

# Limits today <!-- id:5-EyBhYe -->

[Signed blobs](./protocol/blobs.md), content addressing, change histories, branching, [capabilities](./protocol/permissions.md), peer-to-peer [sync](./protocol/network.md) and web publishing all work. There is no web of trust: a public address book of [contacts](./protocol/contacts.md) and explicit permissions exist, and no trust graph does. Each essay ends with the limits that apply to its idea.

# See also <!-- id:mTSC6ba6 -->

- [The Hypermedia protocol](./protocol.md), the precise version of this story. <!-- id:gS3IO-iL -->
- [Glossary](./glossary.md), every term in one line. <!-- id:a1Y3Grqo -->
- [Building on Hypermedia](./build.md), when you are ready to write code. <!-- id:aBzbzMF3 -->
- [The Seed software](./software.md), the programs that implement the protocol. <!-- id:8jcw_LAc -->

# The essays <!-- id:ieZVVTox attrs:{"childrenType":"Grid","columnCount":3} -->

<./why/broken-links.md> <!-- id:dCQ9bsux type:Embed attrs:{"view":"Card"} -->

<./why/inspirations.md> <!-- id:bFCRmxG7 type:Embed attrs:{"view":"Card"} -->

<./why/network-for-thought.md> <!-- id:CEqFRHUi type:Embed attrs:{"view":"Card"} -->

<./why/open-editing.md> <!-- id:v7hzCtan type:Embed attrs:{"view":"Card"} -->

<./why/signed-content.md> <!-- id:5uvcGZcN type:Embed attrs:{"view":"Card"} -->
