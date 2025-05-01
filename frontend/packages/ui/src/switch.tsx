import {Switch, SwitchProps} from 'tamagui'

export function AnimatedSwitch(props: SwitchProps) {
  return (
    <Switch
      borderWidth="$0"
      background={props.checked ? '$brand10' : '$color10'}
      {...props}
    >
      <Switch.Thumb
        size="$3"
        backgroundColor="white"
        borderWidth={2}
        borderColor="black"
        animation="fast"
      />
    </Switch>
  )
}
