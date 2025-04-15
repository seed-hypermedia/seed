# Device Link Protocol

This protocol is used for creating a link between two devices/keys. The idea is that both devices en up with agent capabilities for each other, and one of the devices uses the other device as an alias.

The currently supported workflow is as follows:

1. User initiates a device link session in their desktop app, by using `daemon.CreateDeviceLinkSession` RPC.
2. The session data is transfered via QR code or URL to the web browser (where WebCrypto identity should already exist).
3. The web browser uses the session data to connect to the desktop app via libp2p, and begin the exchange.

The exchange goes as follows:

1. Browser -> Desktop: Sends session secret.
2. Browser -> Desktop: Sends browser's public key.
3. Desktop -> Browser: Sends Agent capability for the browser's public key.
4. Browser -> Desktop: Sends Agent capability for the desktop's public key.
5. Browser -> Desktop: Sends the alias Profile blob.

At the end, both peers end up with the same result:

1. There's an agent capability from Browser to Desktop.
2. There's an agent capability from Desktop to Browser.
3. There's an alias profile blob signed by Browser with Desktop as alias.
