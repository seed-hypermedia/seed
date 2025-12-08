import {client} from '@/trpc'
import {invalidateQueries, queryKeys} from '@shm/shared'
import {useMutation, useQuery} from '@tanstack/react-query'

export type SystemTheme = 'system' | 'light' | 'dark'

export function useSystemThemeWriter() {
  const theme = useQuery({
    queryKey: [queryKeys.SETTINGS, 'theme'],
    queryFn: () => client.appSettings.getSetting.query('theme'),
  })
  const setThemeMutation = useMutation({
    mutationFn: (input: {key: string; value: string}) =>
      client.appSettings.setSetting.mutate(input),
    onSuccess: () => {
      invalidateQueries([queryKeys.SETTINGS, 'theme'])
    },
  })
  function setTheme(theme: SystemTheme) {
    setThemeMutation.mutate({key: 'theme', value: theme})
  }
  return [theme.data, setTheme, theme.isInitialLoading]
}
