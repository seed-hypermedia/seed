import {ReactNode, forwardRef, useEffect, useRef, useState} from 'react'
import {Virtuoso, VirtuosoHandle} from 'react-virtuoso'

export type ListHandle = VirtuosoHandle

export const List = forwardRef(function ListComponent<Item>(
  {
    items,
    renderItem,
    header,
    footer,
    onEndReached,
    fixedItemHeight,
  }: {
    items: Item[]
    renderItem: (row: {item: Item; containerWidth: number}) => ReactNode
    header?: ReactNode | null
    footer?: ReactNode | null
    onEndReached?: () => void
    fixedItemHeight?: number
  },
  ref: React.Ref<VirtuosoHandle>,
) {
  const [containerWidth, setContainerWidth] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const {width, height} = entry.contentRect
        setContainerWidth(width)
        setContainerHeight(height)
      }
    })

    resizeObserver.observe(containerRef.current)
    return () => resizeObserver.disconnect()
  }, [])

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-1 flex-col self-stretch"
    >
      <Virtuoso
        ref={ref}
        fixedItemHeight={fixedItemHeight}
        endReached={() => {
          onEndReached?.()
        }}
        style={{
          height: containerHeight,
          display: 'flex',
          overflowY: 'scroll',
          overflowX: 'hidden',
        }}
        increaseViewportBy={{
          top: 800,
          bottom: 800,
        }}
        components={{
          Header: () => header || null,
          Footer: () => footer || <div style={{height: 30}} />,
        }}
        className="main-scroll-wrapper"
        totalCount={items?.length || 0}
        itemContent={(index) => {
          const item = items?.[index]
          if (!item) return null
          return (
            <div
              className="flex justify-center"
              style={{
                width: containerWidth,
                height: fixedItemHeight || undefined,
              }}
            >
              {renderItem({item, containerWidth})}
            </div>
          )
        }}
      />
    </div>
  )
})
