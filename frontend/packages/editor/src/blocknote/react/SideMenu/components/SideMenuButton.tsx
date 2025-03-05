import {ActionIcon, useMantineTheme} from '@mantine/core'

export const SideMenuButton = (props: {children: JSX.Element}) => {
  const theme = useMantineTheme()

  return (
    <ActionIcon
      size={24}
      sx={{
        '&:hover': {
          backgroundColor:
            theme.other.hovered?.background || theme.colors.gray[1],
          color: theme.other.hovered?.text || theme.black,
        },
      }}
    >
      {props.children}
    </ActionIcon>
  )
}
