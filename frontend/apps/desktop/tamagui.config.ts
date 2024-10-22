import {config} from '@shm/ui'

type Conf = typeof config

declare module 'tamagui' {
  interface TamaguiCustomConfig extends Conf {}

  interface TypeOverride {
    groupNames(): 'header' | 'item' | 'blocknode' | 'pathitem' | 'icon'
  }
}

export default config
