import {
  DAEMON_FILE_URL,
  SiteRoutingProvider,
  UniversalRoutingProvider,
  UnpackedHypermediaId,
} from "@shm/shared";
import {Toaster} from "@shm/ui/src/toast";
import {
  OptimizedImageSize,
  UniversalAppProvider,
} from "@shm/ui/src/universal-app";
import {TamaguiProvider} from "@tamagui/core";
import {PortalProvider} from "@tamagui/portal";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import tamaConf from "../tamagui.config";

const queryClient = new QueryClient();

export const Providers = (props: {children: any}) => {
  return (
    <ThemeProvider>
      <PortalProvider>
        <QueryClientProvider client={queryClient}>
          <UniversalRoutingProvider value={{}}>
            {props.children}
            <Toaster
            // position="bottom-center"
            // toastOptions={{className: 'toaster'}}
            />
          </UniversalRoutingProvider>
        </QueryClientProvider>
      </PortalProvider>
    </ThemeProvider>
  );
};

export function ThemeProvider({children}: {children: React.ReactNode}) {
  return (
    <TamaguiProvider
      defaultTheme="light"
      disableInjectCSS
      disableRootThemeClass
      config={tamaConf}
    >
      {children}
    </TamaguiProvider>
  );
}

export function getOptimizedImageUrl(cid: string, size?: OptimizedImageSize) {
  let url = `/hm/api/image/${cid}`;
  if (size) url += `?size=${size}`;
  return url;
}

export function WebSiteProvider(props: {
  originHomeId: UnpackedHypermediaId;
  children: React.ReactNode;
  siteHost?: string;
}) {
  return (
    <UniversalAppProvider
      originHomeId={props.originHomeId}
      getOptimizedImageUrl={getOptimizedImageUrl}
      ipfsFileUrl={DAEMON_FILE_URL}
    >
      <SiteRoutingProvider originHomeId={props.originHomeId}>
        {props.children}
      </SiteRoutingProvider>
    </UniversalAppProvider>
  );
}
