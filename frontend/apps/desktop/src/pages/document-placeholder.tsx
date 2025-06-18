import {Placeholder} from '@/components/placeholder-box'

export function DocumentPlaceholder() {
  return (
    <div className="mt-7 w-full max-w-[600px] flex flex-col gap-6 mx-auto">
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
    <div className="w-full max-w-[600px] flex flex-col gap-2">
      <Placeholder width="100%" />
      <Placeholder width="92%" />
      <Placeholder width="84%" />
      <Placeholder width="90%" />
    </div>
  )
}
