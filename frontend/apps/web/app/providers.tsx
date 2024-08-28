import {UniversalRoutingProvider} from "@shm/shared";
import {TamaguiProvider} from "@tamagui/core";
import tamaConf from "../tamagui.config";

export const Providers = (props: {children: any}) => {
  return (
    <TamaguiProvider defaultTheme="light" config={tamaConf}>
      <UniversalRoutingProvider value={{}}>
        {props.children}
      </UniversalRoutingProvider>
    </TamaguiProvider>
  );
};
