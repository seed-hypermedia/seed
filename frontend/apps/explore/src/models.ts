import {hmIdPathToEntityQueryPath, UnpackedHypermediaId} from "@shm/shared";
import {ListAPIResponse} from "@shm/shared/src/api-types";
import {unpackHmId} from "@shm/shared/src/utils/entity-id-url";
import {useQuery} from "@tanstack/react-query";
import {getApiHost} from "./queryClient";

async function getAPI<ReturnType>(path: string) {
  const response = await fetch(`${getApiHost()}/api/${path}`);
  return (await response.json()) as ReturnType;
}

export function useRootDocuments() {
  return useQuery({
    queryKey: ["rootDocuments"],
    queryFn: () => getAPI<ListAPIResponse>("list"),
  });
}

export function useEntity(hmId: UnpackedHypermediaId) {
  return useQuery({
    queryKey: ["entity", hmId],
    queryFn: () =>
      getAPI<any>(
        `entity/${hmId.type}/${hmId.uid}${hmIdPathToEntityQueryPath(hmId.path)}`
      ),
  });
}

export function useCID(cid: string | undefined) {
  return useQuery({
    queryKey: ["cid", cid],
    queryFn: () => getAPI<any>(`cid/${cid}`),
    enabled: !!cid,
  });
}

export function useComments(hmId: UnpackedHypermediaId) {
  return useQuery({
    queryKey: ["comments", hmId.id],
    queryFn: () =>
      getAPI<any>(
        `comments/${hmId.uid}${hmIdPathToEntityQueryPath(hmId.path)}`
      ),
  });
}

export function useCitations(hmId: UnpackedHypermediaId) {
  return useQuery({
    queryKey: ["citations", hmId.id],
    queryFn: () =>
      getAPI<any>(
        `citations/${hmId.type}/${hmId.uid}${hmIdPathToEntityQueryPath(
          hmId.path
        )}`
      ),
  });
}

export function useChanges(hmId: UnpackedHypermediaId) {
  return useQuery({
    queryKey: ["changes", hmId.id],
    queryFn: () =>
      getAPI<any>(`changes/${hmId.uid}${hmIdPathToEntityQueryPath(hmId.path)}`),
  });
}

export function useCapabilities(hmId: UnpackedHypermediaId) {
  return useQuery({
    queryKey: ["capabilities", hmId.id],
    queryFn: () =>
      getAPI<any>(
        `capabilities/${hmId.uid}${hmIdPathToEntityQueryPath(hmId.path)}`
      ),
  });
}

export function extractIpfsUrlCid(cidOrIPFSUrl: string): string | null {
  const regex = /^ipfs:\/\/(.+)$/;
  const match = cidOrIPFSUrl.match(regex);
  return match ? match[1] : null;
}

export async function search(input: string) {
  console.log("searching", input);
  const cid = extractIpfsUrlCid(input);
  if (cid) {
    return {destination: `/ipfs/${cid}`};
  }
  if (input.startsWith("hm://")) {
    const unpackedId = unpackHmId(input);
    if (unpackedId) {
      return {
        destination: `/hm/${unpackedId.uid}/${unpackedId.path?.join("/")}`,
      };
    }
  }
  if (input.match(/\./)) {
    // it might be a url
    const hasProtocol = input.match(/^https?:\/\//);
    const searchUrl = hasProtocol ? input : `https://${input}`;
    const result = await fetch(searchUrl, {
      method: "OPTIONS",
    });
    const id = result.headers.get("x-hypermedia-id");
    const unpackedId = id && unpackHmId(id);
    const version = result.headers.get("x-hypermedia-version");
    console.log("version", unpackedId, version);
    // const title = result.headers.get("x-hypermedia-title");
    if (unpackedId) {
      return {
        destination: `/hm/${unpackedId.uid}/${unpackedId.path?.join(
          "/"
        )}?v=${version}`,
      };
    }
  }
  return {
    errorMessage:
      "Invalid input. Please enter a valid hypermedia URL or IPFS url.",
  };
}
