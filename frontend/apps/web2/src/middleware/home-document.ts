import {defineMiddleware} from "astro:middleware";

export const onRequest = defineMiddleware(
  async function homeDocMiddleware(context, next) {
    context.locals.accountUid =
      "z6Mkvz9TgGtv9zsGsdrksfNk1ajbFancgHREJEz3Y2HsAVdk";
    // return a Response or the result of calling `next()`
    return next();
  }
);
