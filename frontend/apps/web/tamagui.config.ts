// import { config } from '@shm/ui'

// type Conf = typeof config

// declare module 'tamagui' {
//   interface TamaguiCustomConfig extends Conf {}

//   interface TypeOverride {
//     groupNames(): 'header' | 'item' | 'blocknode'
//   }
// }

// export default config

import {config} from "@tamagui/config/v3";
import {createTamagui} from "@tamagui/core";

// for site responsive demo
Object.assign(config.media, {
  tiny: {maxWidth: 500},
  gtTiny: {minWidth: 500 + 1},
  small: {maxWidth: 620},
  gtSmall: {minWidth: 620 + 1},
  medium: {maxWidth: 780},
  gtMedium: {minWidth: 780 + 1},
  large: {maxWidth: 900},
  gtLarge: {minWidth: 900 + 1},
});

const tamaConf = createTamagui(config);

export type Conf = typeof tamaConf;

declare module "tamagui" {
  interface TamaguiCustomConfig extends Conf {}

  interface TypeOverride {
    groupNames(): "takeoutBody";
  }
}

export default tamaConf;
