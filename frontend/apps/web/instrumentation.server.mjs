import * as Sentry from "@sentry/remix";

Sentry.init({
  dsn: process.env.SITE_SENTRY_DSN,
  tracesSampleRate: 1,
  autoInstrumentRemix: true,
});
