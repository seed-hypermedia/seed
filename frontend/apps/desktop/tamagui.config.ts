import {config} from '@shm/ui/tamagui.config'

type Conf = typeof config

declare module 'tamagui' {
  interface TamaguiCustomConfig extends Conf {}

  interface TypeOverride {
    groupNames(): 'header' | 'item' | 'blocknode' | 'pathitem' | 'icon'
  }
}

export default config
