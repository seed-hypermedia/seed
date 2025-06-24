import {Separator} from './separator'
import {SizableText} from './text'

export const XPostNotFound = (error: any) => {
  const errorToString = error.error
    ? error.error.status == 404
      ? 'The embedded X Post could not be found.'
      : error.error.toString()
    : ''

  return (
    <div className="flex h-full w-full flex-col items-center justify-center">
      <SizableText size="xl" color="destructive">
        Error fetching the X Post
      </SizableText>
      <SizableText size="lg" color="destructive">
        {errorToString}
      </SizableText>
    </div>
  )
}

export const XPostSkeleton = () => {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2">
      <div className="h-20 w-20 rounded-full bg-gray-500" />
      <div className="h-15 rounded-lg bg-gray-500" style={{width: '98%'}} />
      <Separator className="my-2" />
      <div
        className="ml-2 h-15 rounded-lg bg-gray-500"
        style={{width: '98%'}}
      />
      <Separator className="my-2" />
      <div className="h-15 rounded-lg bg-gray-500" style={{width: '98%'}} />
    </div>
  )
}
