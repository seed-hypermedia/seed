export function parseRequest(request: Request) {
  const url = new URL(request.url);
  const hostname = request.headers.get("x-forwarded-host") || url.hostname;
  let pathParts = url.pathname.split("/").slice(1);
  if (pathParts.at(-1) === "") {
    pathParts = pathParts.slice(0, -1);
  }
  return {
    hostname,
    url,
    pathParts,
    method: request.method,
    headers: request.headers,
  };
}

export type ParsedRequest = ReturnType<typeof parseRequest>;
