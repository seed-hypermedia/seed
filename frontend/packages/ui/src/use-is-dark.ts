import {useMemo} from 'react'
import {useThemeName} from 'tamagui'

export function useIsDark() {
  const themeName = useThemeName()
  return useMemo(() => themeName === 'dark', [themeName])
}
