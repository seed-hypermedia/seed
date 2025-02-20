export function parseRequest(request: Request) {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  console.log("x-forwarded-host", forwardedHost);
  console.log("url.hostname", url.hostname);
  const hostname = forwardedHost || url.hostname;
  let pathParts = url.pathname.split("/").slice(1);
  if (pathParts.at(-1) === "") {
    pathParts = pathParts.slice(0, -1);
  }
  return {
    hostname,
    fullOrigin: `https://${hostname}`, // Where do we get the protocol from?
    url,
    pathParts,
    method: request.method,
    headers: request.headers,
  };
}

export type ParsedRequest = ReturnType<typeof parseRequest>;
