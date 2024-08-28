import {config} from "@shm/ui/src/tamagui.config";

type Conf = typeof config;

declare module "tamagui" {
  interface TamaguiCustomConfig extends Conf {}

  interface TypeOverride {
    groupNames(): "header" | "item" | "blocknode";
  }
}

export default config;
