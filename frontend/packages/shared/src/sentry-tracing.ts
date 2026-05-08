/** Sentry trace propagation targets for browser clients. */
export const seedBrowserTracePropagationTargets: Array<string | RegExp> = [
  // Match public web app/site origins, but not service origins like
  // host.seed.hyper.media or ln.seed.hyper.media. Those services don't consume
  // browser trace headers, and adding sentry-trace/baggage forces CORS
  // preflights that their allowlists may reject.
  /^https:\/\/(?:[a-z0-9-]+\.)?hyper\.media(?::\d+)?(?:[/?#]|$)/i,
] satisfies Array<string | RegExp>
