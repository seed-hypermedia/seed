import {trpc} from '@/trpc'
import {invalidateQueries, queryKeys} from '@shm/shared'

export type SystemTheme = 'system' | 'light' | 'dark'

export function useSystemThemeWriter() {
  const theme = trpc.appSettings.getSetting.useQuery('theme')
  const setThemeMutation = trpc.appSettings.setSetting.useMutation({
    onSuccess: () => {
      invalidateQueries([queryKeys.SETTINGS, 'theme'])
    },
  })
  function setTheme(theme: SystemTheme) {
    setThemeMutation.mutate({key: 'theme', value: theme})
  }
  return [theme.data, setTheme, theme.isInitialLoading]
}
