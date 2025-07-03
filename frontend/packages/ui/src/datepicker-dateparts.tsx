import type {DatePickerProviderProps} from '@rehookify/datepicker'
import {
  DatePickerProvider as _DatePickerProvider,
  useDatePickerContext,
} from '@rehookify/datepicker'
import {getFontSized} from '@tamagui/get-font-sized'
import {Calendar, ChevronLeft, ChevronRight, X} from '@tamagui/lucide-icons'
import type {GestureReponderEvent} from '@tamagui/web'
import type {PopoverProps} from 'tamagui'
import {
  Adapt,
  AnimatePresence,
  Button,
  Popover,
  Text,
  createStyledContext,
  isWeb,
  styled,
  withStaticProperties,
} from 'tamagui'

import {useEffect, useRef} from 'react'
import {Input} from './datepicker-inputparts'
import {useDateAnimation} from './datepicker-usedateanimation'
import {cn} from './utils'

/** rehookify internally return `onClick` and that's incompatible with native */
export function swapOnClick<D>(d: D) {
  //@ts-ignore
  d.onPress = d.onClick
  return d
}

const DatePickerProvider =
  _DatePickerProvider as React.ComponentType<DatePickerProviderProps>

type DatePickerProps = PopoverProps & {
  config: DatePickerProviderProps['config']
}

export const {Provider: HeaderTypeProvider, useStyledContext: useHeaderType} =
  createStyledContext({
    type: 'day',
    setHeader: (_: 'day' | 'month' | 'year') => {},
  })

const DatePickerImpl = (props: DatePickerProps) => {
  const {children, config, ...rest} = props
  const popoverRef = useRef<Popover>(null)

  // hide date picker on scroll (web)
  useEffect(() => {
    if (isWeb) {
      const controller = new AbortController()

      document.body.addEventListener(
        'scroll',
        () => {
          popoverRef.current?.close()
        },
        {
          signal: controller.signal,
        },
      )

      return () => {
        controller.abort()
      }
    }
  }, [])

  return (
    <DatePickerProvider config={config}>
      <Popover
        ref={popoverRef}
        keepChildrenMounted
        size="$5"
        allowFlip
        {...rest}
      >
        <Adapt when="sm">
          <Popover.Sheet modal dismissOnSnapToBottom snapPointsMode="fit">
            <Popover.Sheet.Frame padding="$8" alignItems="center">
              <Adapt.Contents />
            </Popover.Sheet.Frame>
            <Popover.Sheet.Overlay
              animation="lazy"
              enterStyle={{opacity: 0}}
              exitStyle={{opacity: 0}}
            />
          </Popover.Sheet>
        </Adapt>
        {children}
      </Popover>
    </DatePickerProvider>
  )
}

const Trigger = Popover.Trigger

const DatePickerContent = styled(Popover.Content, {
  animation: [
    '100ms',
    {
      opacity: {
        overshootClamping: true,
      },
    },
  ],
  variants: {
    unstyled: {
      false: {
        padding: 12,
        borderWidth: 1,
        borderColor: '$borderColor',
        enterStyle: {y: -10, opacity: 0},
        exitStyle: {y: -10, opacity: 0},
        elevate: true,
      },
    },
  } as const,
  defaultVariants: {
    unstyled: process.env.TAMAGUI_HEADLESS === '1',
  },
})

export const DatePicker = withStaticProperties(DatePickerImpl, {
  Trigger,
  Content: withStaticProperties(DatePickerContent, {
    Arrow: styled(Popover.Arrow, {
      borderWidth: 1,
      borderColor: '$borderColor',
    }),
  }),
})

type DatePickerInputProps = {
  onReset: () => void
  onButtonPress?: (e: GestureReponderEvent) => void
}

export const DatePickerInput = Input.Area.styleable<DatePickerInputProps>(
  (props, ref) => {
    const {value, onButtonPress, size = '$3', onReset, ...rest} = props
    return (
      <div className="min-w-full sm:min-w-0">
        <Input size={size}>
          <Input.Box>
            <Input.Section>
              <Input.Area value={value} ref={ref} {...rest} color="$color11" />
            </Input.Section>
            <Input.Section>
              <Input.Button
                onPress={(e) => {
                  if (value) {
                    e.stopPropagation()
                    onReset()
                  } else {
                    onButtonPress?.(e)
                  }
                }}
              >
                {value ? (
                  <Input.Icon>
                    <X />
                  </Input.Icon>
                ) : (
                  <Input.Icon>
                    <Calendar />
                  </Input.Icon>
                )}
              </Input.Button>
            </Input.Section>
          </Input.Box>
        </Input>
      </div>
    )
  },
)

export function MonthPicker({
  onChange = (_e, _date) => {
    'noop'
  },
}: {
  onChange?: (e: MouseEvent, date: Date) => void
}) {
  const {
    data: {months},
    propGetters: {monthButton},
  } = useDatePickerContext()

  const {prevNextAnimation, prevNextAnimationKey} = useDateAnimation({
    listenTo: 'year',
  })

  return (
    <AnimatePresence key={prevNextAnimationKey}>
      <div
        {...prevNextAnimation()}
        className={cn(
          'flex flex-grow-0 flex-row flex-wrap gap-2',
          'sm:w-full sm:justify-between',
          'xs:w-[285px]',
        )}
      >
        {months.map((month) => (
          <Button
            themeInverse={month.active}
            borderRadius="$true"
            flexShrink={0}
            flexBasis={90}
            backgroundColor={month.active ? '$background' : 'transparent'}
            key={month.$date.toString()}
            chromeless
            padding={0}
            {...swapOnClick(
              monthButton(month, {
                onClick: onChange as any,
              }),
            )}
          >
            <Button.Text color={month.active ? '$gray12' : '$gray11'}>
              {month.month}
            </Button.Text>
          </Button>
        ))}
      </div>
    </AnimatePresence>
  )
}

export function YearPicker({
  onChange = () => {},
}: {
  onChange?: (e: MouseEvent, date: Date) => void
}) {
  const {
    data: {years, calendars},
    propGetters: {yearButton},
  } = useDatePickerContext()
  const selectedYear = calendars[0].year

  const {prevNextAnimation, prevNextAnimationKey} = useDateAnimation({
    listenTo: 'years',
  })

  return (
    <AnimatePresence key={prevNextAnimationKey}>
      <div
        {...prevNextAnimation()}
        className="flex w-full max-w-[280px] flex-row flex-wrap justify-between gap-2"
      >
        {years.map((year) => (
          <Button
            themeInverse={year.year === Number(selectedYear)}
            borderRadius="$true"
            flexBasis="30%"
            flexGrow={1}
            backgroundColor={
              year.year === Number(selectedYear) ? '$background' : 'transparent'
            }
            key={year.$date.toString()}
            chromeless
            padding={0}
            {...swapOnClick(
              yearButton(year, {
                onClick: onChange as any,
              }),
            )}
          >
            <Button.Text
              color={year.year === Number(selectedYear) ? '$gray12' : '$gray11'}
            >
              {year.year}
            </Button.Text>
          </Button>
        ))}
      </div>
    </AnimatePresence>
  )
}
export function YearRangeSlider() {
  const {
    data: {years},
    propGetters: {previousYearsButton, nextYearsButton},
  } = useDatePickerContext()

  return (
    <div className="flex w-full flex-row items-center justify-between">
      <Button circular size="$4" {...swapOnClick(previousYearsButton())}>
        <Button.Icon scaleIcon={1.5}>
          <ChevronLeft />
        </Button.Icon>
      </Button>
      <div className="flex translate-y-0.5 flex-col items-center">
        <SizableText size="$5">
          {`${years[0].year} - ${years[years.length - 1].year}`}
        </SizableText>
      </div>
      <Button circular size="$4" {...swapOnClick(nextYearsButton())}>
        <Button.Icon scaleIcon={1.5}>
          <ChevronRight />
        </Button.Icon>
      </Button>
    </div>
  )
}

export function YearSlider() {
  const {
    data: {calendars},
    propGetters: {subtractOffset},
  } = useDatePickerContext()
  const {setHeader} = useHeaderType()
  const {year} = calendars[0]
  return (
    <div className="flex h-[50px] w-full flex-row items-center justify-between">
      <Button circular size="$3" {...swapOnClick(subtractOffset({months: 12}))}>
        <Button.Icon scaleIcon={1.5}>
          <ChevronLeft />
        </Button.Icon>
      </Button>
      <SizableText
        onPress={() => setHeader('year')}
        selectable
        tabIndex={0}
        size="$6"
        cursor="pointer"
        color="$color11"
        hoverStyle={{
          color: '$color12',
        }}
      >
        {year}
      </SizableText>
      <Button
        circular
        size="$3"
        {...swapOnClick(subtractOffset({months: -12}))}
      >
        <Button.Icon scaleIcon={1.5}>
          <ChevronRight />
        </Button.Icon>
      </Button>
    </div>
  )
}

export const SizableText = styled(Text, {
  name: 'SizableText',
  fontFamily: '$body',

  variants: {
    size: {
      '...fontSize': getFontSized,
    },
  } as const,

  defaultVariants: {
    size: '$true',
  },
})
