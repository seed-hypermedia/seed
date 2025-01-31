export function parseRequest(request: Request) {
  const url = new URL(request.url);
  const hostname = request.headers.get("x-forwarded-host") || url.hostname;
  const pathParts = url.pathname.split("/").slice(1);
  return {
    hostname,
    url,
    pathParts,
    headers: request.headers,
  };
}

export type ParsedRequest = ReturnType<typeof parseRequest>;
