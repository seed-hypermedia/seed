import {DAEMON_FILE_URL, UnpackedHypermediaId} from "@shm/shared";
import {createContext, useContext} from "react";

console.log("=== import universal-app " + DAEMON_FILE_URL);
export type OptimizedImageSize = "S" | "M" | "L" | "XL";

type UniversalAppContextValue = {
  originHomeId?: UnpackedHypermediaId;
  ipfsFileUrl?: string;
  getOptimizedImageUrl?: (cid: string, size?: OptimizedImageSize) => string;
};

export const UniversalAppContext = createContext<UniversalAppContextValue>({
  ipfsFileUrl: DAEMON_FILE_URL,
});

export function UniversalAppProvider(props: {
  children: React.ReactNode;
  originHomeId?: UnpackedHypermediaId;
  ipfsFileUrl?: string;
  getOptimizedImageUrl?: (cid: string, size?: OptimizedImageSize) => string;
}) {
  return (
    <UniversalAppContext.Provider
      value={{
        originHomeId: props.originHomeId,
        ipfsFileUrl: props.ipfsFileUrl,
        getOptimizedImageUrl: props.getOptimizedImageUrl,
      }}
    >
      {props.children}
    </UniversalAppContext.Provider>
  );
}

export function useUniversalAppContext() {
  const context = useContext(UniversalAppContext);
  if (!context) {
    throw new Error(
      "useUniversalAppContext must be used within a UniversalAppProvider"
    );
  }
  return context;
}
