import {useFetcher} from "@remix-run/react";
import {
  HMAccountsMetadata,
  HMDocument,
  HMQueryResult,
  packHmId,
  UnpackedHypermediaId,
} from "@shm/shared";
import {useQuery} from "@tanstack/react-query";
import {useEffect} from "react";
import {deserialize} from "superjson";
import {HMDocumentChangeInfo} from "./routes/hm.api.changes";
import {unwrap} from "./wrapping";

export function useEntity(id: UnpackedHypermediaId | undefined) {
  return useQuery({
    queryKey: ["entity", id?.id, id?.version, id?.latest],
    useErrorBoundary: false,
    queryFn: async () => {
      if (!id?.uid) return;
      const queryString = new URLSearchParams({
        v: id.version || "",
        l: id.latest ? "true" : "",
      }).toString();
      const url = `/hm/api/entity/${id.uid}${
        id.path ? `/${id.path.join("/")}` : ""
      }?${queryString}`;
      const response = await fetch(url);
      const fullData = await response.json();
      const data = deserialize(fullData) as any;
      return {
        id: data.id as UnpackedHypermediaId,
        document: data.document as HMDocument,
        supportDocuments: data.supportDocuments as {
          id: UnpackedHypermediaId;
          document: HMDocument;
        }[],
        supportQueries: data.supportQueries as HMQueryResult[],
        siteHost: data.siteHost as string,
        accountsMetadata: data.accountsMetadata as HMAccountsMetadata,
      };
    },
  });
}

export function useDocumentChanges(id: UnpackedHypermediaId | undefined) {
  const fetcher = useFetcher();
  useEffect(() => {
    if (!id?.uid) return;
    const url = `/hm/api/changes?id=${packHmId(id)}`;
    fetcher.load(url);
  }, [id?.uid, id?.path?.join("/")]);

  return {
    data: fetcher.data
      ? unwrap<Array<HMDocumentChangeInfo>>(fetcher.data)
      : null,
    isLoading: fetcher.state === "loading",
  };
}

export function useAPI<ResponsePayloadType>(url?: string) {
  const fetcher = useFetcher();
  useEffect(() => {
    if (!url) return;
    fetcher.load(url);
  }, [url]);
  if (!url) return undefined;
  const response = fetcher.data
    ? unwrap<ResponsePayloadType>(fetcher.data)
    : undefined;
  return response;
}
