import {defineMiddleware} from "astro:middleware";
import {getConfig} from "../utils/config";

export const onRequest = defineMiddleware(
  async function homeDocMiddleware(context, next) {
    const config = getConfig();

    if (!config.registeredAccountUid) {
      console.log("IS NOT SETUP");
      return next(
        new Request(new URL("/setup", context.request.url), {
          headers: {
            "x-redirect-to": context.url.pathname,
          },
        })
      );
    } else {
      context.locals.accountUid = config.registeredAccountUid;

      return next();
    }
  }
);
