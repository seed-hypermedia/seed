import {UniversalRoutingProvider} from "@shm/shared";
import {TamaguiProvider} from "@tamagui/core";
import tamaConf from "../tamagui.config";

export const Providers = (props: {children: any}) => {
  return (
    <ThemeProvider>
      <UniversalRoutingProvider value={{}}>
        {props.children}
      </UniversalRoutingProvider>
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
