// import {Interceptor} from '@bufbuild/connect-web'

// TODO: change to expect-error instead
// @ts-ignore
export const loggingInterceptor = (next) => async (req) => {
  const timeout = setTimeout(() => {
    console.log(`🚨 TIMEOUT on ${req.method.name}`, req.message)
  }, 5000)
  try {
    console.log(`↗️ to ${req.method.name}`, req.message)
    const result = await next(req)
    clearTimeout(timeout)
    // @ts-ignore
    console.log(`🔃 to ${req.method.name}`, req.message, result?.message)
    return result
  } catch (e) {
    clearTimeout(timeout)
    console.error(`🚨 to ${req.method.name}`, req.message, e)
    throw e
  }
}

// TODO: change to expect-error instead
// @ts-ignore
export const prodInter = (next) => async (req) => {
  const result = await next({
    ...req,
    init: {...req.init, redirect: 'follow'},
  })
  return result
}
