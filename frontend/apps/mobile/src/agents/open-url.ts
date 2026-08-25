/**
 * Opening a link an agent produced.
 *
 * The whole point of an agent that can publish is that its results are real hypermedia — so an
 * `hm://` link in a reply opens the document screen in-app rather than bouncing out to a browser.
 * The routing lives in the platform adapter, the one place that knows how this app navigates.
 *
 * Re-exported as a plain function rather than reached through the seam's `useOpenUrl`, because the
 * chat rows call it from press handlers: `useOpenUrl` is a hook, and calling it outside render
 * would be a rules-of-hooks violation even where the current implementation happens not to use one.
 */

export {openUrlOnMobile as openUrlFromAgents} from './platform'
