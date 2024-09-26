import {useFetcher} from "@remix-run/react";
import {packHmId, UnpackedHypermediaId} from "@shm/shared";
import {useEffect} from "react";
import {type WebDocumentPayload} from "./loaders";
import {HMDocumentChangeInfo} from "./routes/hm.api.changes";
import {unwrap} from "./wrapping";

export function useEntity(id: UnpackedHypermediaId | undefined) {
  const fetcher = useFetcher();
  useEffect(() => {
    if (!id?.uid) return;
    const url = `/hm/api/entity/${id.uid}${
      id.path ? `/${id.path.join("/")}` : ""
    }`;
    fetcher.load(url);
  }, [id?.uid, id?.path?.join("/")]);

  return {
    data: fetcher.data ? unwrap<WebDocumentPayload>(fetcher.data) : null,
    isLoading: fetcher.state === "loading",
  };
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

export function getParentPaths(path?: string[] | null): string[][] {
  if (!path) return [[]];
  let walkParentPaths: string[] = [];
  return [
    [],
    ...path.map((term) => {
      walkParentPaths = [...walkParentPaths, term];
      return walkParentPaths;
    }),
  ];
}
