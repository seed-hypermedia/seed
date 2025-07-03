import 'katex/dist/katex.min.css'
import {Button} from 'tamagui'
import './document-content.css'
import {SizableText} from './text'
import {cn} from './utils'

export function QueryBlockPlaceholder({
  styleType,
}: {
  styleType: 'Card' | 'List'
}) {
  if (styleType === 'Card') {
    return <QueryBlockCardPlaceholder />
  }

  return <QueryBlockListPlaceholder />
}

export function QueryBlockCardPlaceholder() {
  return (
    <div className="-mx-2 flex w-full flex-wrap">
      <EntityCardPlaceholder />
      <EntityCardPlaceholder />
      <EntityCardPlaceholder />
    </div>
  )
}

export function QueryBlockListPlaceholder() {
  return (
    <div className="flex w-full flex-col gap-2">
      <ListItemSkeleton />
      <ListItemSkeleton />
      <ListItemSkeleton />
    </div>
  )
}

export function EntityCardPlaceholder() {
  return (
    <div className="flex-basis-full sm:flex-basis-1/2 md:flex-basis-1/3 flex-none flex-shrink-0 p-2">
      <div className="bg-muted border-border flex flex-1 flex-col overflow-hidden rounded-lg border">
        <CoverPlaceholder />
        <div className="flex flex-1 flex-col">
          <div className="flex flex-col gap-4 p-4">
            {/* document name */}
            <div className="flex flex-col gap-2">
              <TextPlaceholder height={24} />
              <TextPlaceholder height={24} width="70%" />
            </div>

            {/* location and author */}
            <TextPlaceholder height={14} width="35%" />

            <div className="flex flex-col gap-2">
              <TextPlaceholder height={12} />
              <TextPlaceholder height={12} width="75%" />
              <TextPlaceholder height={12} width="80%" />
              <TextPlaceholder height={12} width="60%" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function CoverPlaceholder() {
  return <div className="bg-muted-foreground/20 h-[180px] w-full" />
}

function TextPlaceholder({
  height = 16,
  width = '100%',
  color = 'bg-muted-foreground/20',
}: {
  height?: number | string
  width?: number | string
  color?: string
}) {
  return (
    <div
      className={cn('overflow-hidden rounded-full', color)}
      style={{
        height: typeof height === 'number' ? `${height}px` : height,
        width: typeof width === 'number' ? `${width}px` : width,
      }}
    />
  )
}

export function ListItemSkeleton() {
  return (
    <Button
      borderWidth={1}
      borderColor="$borderColor"
      paddingHorizontal={16}
      paddingVertical="$1"
      bg="$backgroundHover"
      h={60}
      disabled
      gap="$2"
    >
      <Skeleton width={28} height={28} borderRadius={28} />

      <div className="flex flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <Skeleton w="100%" maxWidth={300} height={20} borderRadius="$1" />
        </div>
        <div className="flex w-full gap-2 overflow-hidden">
          <Skeleton w="100%" maxWidth={200} height={14} borderRadius="$1" />
        </div>
      </div>
      <Skeleton w="100%" maxWidth={80} height={20} borderRadius="$1" />

      <div className="flex">
        <Skeleton width={24} height={24} borderRadius={100} />
        <Skeleton width={24} height={24} borderRadius={100} marginLeft={-8} />
      </div>
    </Button>
  )
}

function Skeleton(
  props: React.HTMLAttributes<HTMLDivElement> & {
    w?: string | number
    width?: number
    height?: number
    maxWidth?: number
    borderRadius?: number | string
    marginLeft?: number
  },
) {
  const {
    w,
    width,
    height,
    maxWidth,
    borderRadius,
    marginLeft,
    className,
    style,
    ...rest
  } = props
  return (
    <div
      className={cn('bg-muted-foreground/20', className)}
      style={{
        width: w || (width ? `${width}px` : undefined),
        height: height ? `${height}px` : undefined,
        maxWidth: maxWidth ? `${maxWidth}px` : undefined,
        borderRadius:
          typeof borderRadius === 'number' ? `${borderRadius}px` : borderRadius,
        marginLeft: marginLeft ? `${marginLeft}px` : undefined,
        ...style,
      }}
      {...rest}
    />
  )
}

export function BlankQueryBlockMessage({message}: {message: string}) {
  return (
    <div className="bg-muted flex items-center rounded-lg p-4">
      <SizableText size="lg" color="muted" weight="bold" className="italic">
        {message}
      </SizableText>
    </div>
  )
}
