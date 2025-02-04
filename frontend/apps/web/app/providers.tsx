import {UniversalRoutingProvider} from "@shm/shared";
import {Toaster} from "@shm/ui/src/toast";
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
    <TamaguiProvider defaultTheme="light" config={tamaConf}>
      {children}
    </TamaguiProvider>
  );
}
