import type {DPDay} from '@rehookify/datepicker'
import {useDatePickerContext} from '@rehookify/datepicker'
import {ChevronLeft, ChevronRight} from '@tamagui/lucide-icons'
import {useEffect, useMemo, useState} from 'react'
import {AnimatePresence, Button} from 'tamagui'

import {
  DatePicker,
  DatePickerInput,
  HeaderTypeProvider,
  MonthPicker,
  SizableText,
  YearPicker,
  YearRangeSlider,
  swapOnClick,
  useHeaderType,
} from './datepicker-dateparts'
import {useDateAnimation} from './datepicker-usedateanimation'

function CalendarHeader() {
  const {
    data: {calendars},
    propGetters: {subtractOffset},
  } = useDatePickerContext()
  const {type: header, setHeader} = useHeaderType()
  const {year, month} = calendars[0]

  if (header === 'year') {
    return <YearRangeSlider />
  }

  if (header === 'month') {
    return (
      <SizableText
        width="100%"
        ta="center"
        userSelect="auto"
        tabIndex={0}
        size="$8"
      >
        Select a month
      </SizableText>
    )
  }
  return (
    <div className="flex h-[50px] w-full flex-row items-center justify-between">
      <Button circular size="$4" {...swapOnClick(subtractOffset({months: 1}))}>
        <Button.Icon scaleIcon={1.5}>
          <ChevronLeft />
        </Button.Icon>
      </Button>
      <div className="flex h-[50px] flex-col items-center">
        <SizableText
          onPress={() => setHeader('year')}
          userSelect="auto"
          tabIndex={0}
          size="$4"
          cursor="pointer"
          color="$color11"
          hoverStyle={{
            color: '$color12',
          }}
        >
          {year}
        </SizableText>
        <SizableText
          onPress={() => setHeader('month')}
          userSelect="auto"
          cursor="pointer"
          tabIndex={0}
          size="$6"
          color="$gray12"
          fontWeight="600"
          lineHeight="$1"
          hoverStyle={{
            color: '$gray10',
          }}
        >
          {month}
        </SizableText>
      </div>
      <Button circular size="$4" {...swapOnClick(subtractOffset({months: -1}))}>
        <Button.Icon scaleIcon={1.5}>
          <ChevronRight />
        </Button.Icon>
      </Button>
    </div>
  )
}

function DayPicker() {
  const {
    data: {calendars, weekDays},
    propGetters: {dayButton},
  } = useDatePickerContext()

  const {days} = calendars[0]

  const {prevNextAnimation, prevNextAnimationKey} = useDateAnimation({
    listenTo: 'month',
  })

  // divide days array into sub arrays that each has 7 days, for better stylings
  const subDays = useMemo(
    () =>
      days.reduce((acc, day, i) => {
        if (i % 7 === 0) {
          acc.push([])
        }
        acc[acc.length - 1].push(day)
        return acc
      }, [] as DPDay[][]),
    [days],
  )

  return (
    <AnimatePresence key={prevNextAnimationKey}>
      <div className="animate-in" {...prevNextAnimation()}>
        <div className="flex flex-row gap-1">
          {weekDays.map((day) => (
            <SizableText key={day} ta="center" width={45} size="$4">
              {day}
            </SizableText>
          ))}
        </div>
        <div className="flex flex-col flex-wrap gap-1">
          {subDays.map((days) => {
            return (
              <div
                className="flex flex-row gap-1"
                key={days[0].$date.toString()}
              >
                {days.map((d) => (
                  <Button
                    key={d.$date.toString()}
                    chromeless
                    circular
                    padding={0}
                    width={45}
                    {...swapOnClick(dayButton(d))}
                    backgroundColor={d.selected ? '$background' : 'transparent'}
                    themeInverse={d.selected}
                    disabled={!d.inCurrentMonth}
                  >
                    <Button.Text
                      color={
                        d.selected
                          ? '$gray12'
                          : d.inCurrentMonth
                          ? '$gray11'
                          : '$gray6'
                      }
                    >
                      {d.day}
                    </Button.Text>
                  </Button>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </AnimatePresence>
  )
}

function DatePickerBody() {
  const [header, setHeader] = useState<'day' | 'month' | 'year'>('day')

  return (
    <HeaderTypeProvider type={header} setHeader={setHeader}>
      <div className="flex max-w-[325px] flex-col items-center gap-2.5">
        <CalendarHeader />
        {header === 'month' && (
          <MonthPicker onChange={() => setHeader('day')} />
        )}
        {header === 'year' && <YearPicker onChange={() => setHeader('day')} />}
        {header === 'day' && <DayPicker />}
      </div>
    </HeaderTypeProvider>
  )
}

export function SimpleDatePicker({
  onReset,
  value,
  onValue,
}: {
  onReset: () => void
  value: string
  onValue: (value: string) => void
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setOpen(false)
  }, [value])

  return (
    <DatePicker
      keepChildrenMounted
      open={open}
      onOpenChange={setOpen}
      config={{
        selectedDates: [new Date(value)],
        onDatesChange: (dates) => {
          const date = dates[0]
          if (!date) {
            onReset()
          } else {
            // Adjust the local date to UTC date
            const adjustedDate = new Date(
              date.getTime() - date.getTimezoneOffset() * 60000,
            )
            onValue(adjustedDate.toISOString().slice(0, 10))
          }
        },
        calendar: {
          startDay: 1,
        },
      }}
    >
      <DatePicker.Trigger asChild>
        <DatePickerInput
          placeholder="Select Date"
          value={value}
          onReset={onReset}
          onButtonPress={() => setOpen(true)}
        />
      </DatePicker.Trigger>
      <DatePicker.Content>
        <DatePicker.Content.Arrow />
        <DatePickerBody />
      </DatePicker.Content>
    </DatePicker>
  )
}
