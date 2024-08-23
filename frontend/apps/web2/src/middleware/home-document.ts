export function onRequest(context, next) {
  context.locals.accountUid =
    "z6MkkEnUheepjpmhwkF7m8tVLPXAzBadPeajriaVUXYoTteJ";

  // return a Response or the result of calling `next()`
  return next();
}
