import { DAEMON_FILE_URL } from "@shm/shared";
import {
  OptimizedImageSize,
  useUniversalAppContext,
} from "@shm/ui/src/universal-app";

console.log("=== import get-file-url");

export function getDaemonFileUrl(ipfsUrl?: string) {
  if (ipfsUrl) {
    return `${DAEMON_FILE_URL}/${extractIpfsUrlCid(ipfsUrl)}`;
  }
  return "";
}

export function extractIpfsUrlCid(url: string): null | string {
  const regex = /^ipfs:\/\/(.+)$/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

export function isIpfsUrl(url: string): boolean {
  return url.startsWith("ipfs://");
}

export function useImageUrl() {
  const {ipfsFileUrl, getOptimizedImageUrl} = useUniversalAppContext();
  return (ipfsUrl: string, optimizedSize?: OptimizedImageSize) => {
    const cid = extractIpfsUrlCid(ipfsUrl);
    if (!cid) return "";
    if (getOptimizedImageUrl) return getOptimizedImageUrl(cid, optimizedSize);
    return `${ipfsFileUrl || ""}/${cid}`;
  };
}

export function useFileUrl() {
  const {ipfsFileUrl} = useUniversalAppContext();
  return (ipfsUrl: string) => {
    const cid = extractIpfsUrlCid(ipfsUrl);
    if (!cid) return "";
    return `${ipfsFileUrl || ""}/${cid}`;
  };
}
