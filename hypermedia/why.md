---
name: Why Hypermedia
summary: This section gives the reasons behind the Hypermedia protocol for any reader, with one page for each idea and a plain note on its limits.
---
The web lets anyone publish, but it forgets. Pages vanish, and links to them break. The web cannot prove who wrote what. And it gives you only two ways to reuse someone else's work: a link that may break, or a copy that loses the author's name. Hypermedia fixes these three problems in the protocol itself, with no company in the middle. <!-- id:L8-LA2xM -->

This section explains why. You do not need to know what a hash is to read it. Every term links to the page that explains it, and the [glossary](./glossary.md) lists them all. [The Hypermedia protocol](./protocol.md) tells the same story in exact terms. <!-- id:gLY12IhF -->

# The ideas <!-- id:X5LmMDb3 -->

<!-- id:c-ajZqQH -->
- [The end of broken links](./why/broken-links.md). Why content is named by a hash of its bytes, and why a link keeps working as long as anyone holds a copy.
- [Signed content](./why/signed-content.md). Why authors sign on their own devices, and why Hypermedia is not built on ActivityPub.
- [Open editing](./why/open-editing.md). Version history, making your own version in your own [space](./protocol/spaces.md), and the git model behind both.
- [A network for thought](./why/network-for-thought.md). What having no login means, what your computer holds, and how the ordinary web fits in.
- [Inspirations](./why/inspirations.md). The earlier systems these ideas come from.

# What this is not <!-- id:ERXjT6ks -->

Hypermedia is not a social network, a blockchain, or a closed platform. It has no token, and its computers do not need to agree on one shared record. You do not have to use the hosted servers. Seed, the software, is open source under the Apache license. The hosted [sites](./protocol/sites.md) at hyper.media are a convenience. A site you host yourself is an equal part of the network. <!-- id:1EzTuUVy -->

# Limits <!-- id:5-EyBhYe -->

These parts work: [signed blobs](./protocol/blobs.md), content named by its hash, change histories, branching, [capabilities](./protocol/permissions.md), peer-to-peer [sync](./protocol/network.md) and web publishing. There is no web of trust. People keep a public address book of [contacts](./protocol/contacts.md) and give explicit permissions, and nothing ranks strangers by who your contacts know. Each of the four idea essays ends with the limits that apply to it.

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
