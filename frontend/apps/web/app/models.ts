import { useQuery, UseQueryOptions } from "@tanstack/react-query";
import { unwrap } from "./wrapping";

// queryAPI for universal client and useAPI hook - unwraps superjson
export async function queryAPI<ResponsePayloadType>(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  }
  const fullData = await response.json();
  return unwrap<ResponsePayloadType>(fullData);
}

export function useAPI<ResponsePayloadType>(
  url?: string,
  queryOptions?: UseQueryOptions<unknown, unknown, ResponsePayloadType>
) {
  const query = useQuery({
    queryKey: ["api", url],
    queryFn: async () => {
      if (!url) return;
      return await queryAPI<ResponsePayloadType>(url);
    },
    ...queryOptions,
  });
  return query;
}
