import {Placeholder} from '@/components/placeholder-box'

export function DocumentPlaceholder() {
  return (
    <div className="mx-auto mt-7 flex w-full max-w-[600px] flex-col gap-6">
      <BlockPlaceholder />
      <BlockPlaceholder />
      <BlockPlaceholder />
      <BlockPlaceholder />
      <BlockPlaceholder />
    </div>
  )
}

function BlockPlaceholder() {
  return (
    <div className="flex w-full max-w-[600px] flex-col gap-2">
      <Placeholder width="100%" />
      <Placeholder width="92%" />
      <Placeholder width="84%" />
      <Placeholder width="90%" />
    </div>
  )
}
