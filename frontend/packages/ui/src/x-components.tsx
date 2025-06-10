import {Separator} from './separator'
import {SizableText} from './text'

export const XPostNotFound = (error: any) => {
  const errorToString = error.error
    ? error.error.status == 404
      ? 'The embedded X Post could not be found.'
      : error.error.toString()
    : ''

  return (
    <div className="flex flex-col items-center justify-center w-full h-full">
      <SizableText size="xl" color="danger">
        Error fetching the X Post
      </SizableText>
      <SizableText size="lg" color="danger">
        {errorToString}
      </SizableText>
    </div>
  )
}

export const XPostSkeleton = () => {
  return (
    <div className="flex flex-col items-center justify-center w-full h-full gap-2">
      <div className="w-20 h-20 bg-gray-500 rounded-full" />
      <div className="h-15 bg-gray-500 rounded-lg" style={{width: '98%'}} />
      <Separator className="my-2" />
      <div
        className="h-15 ml-2 bg-gray-500 rounded-lg"
        style={{width: '98%'}}
      />
      <Separator className="my-2" />
      <div className="h-15 bg-gray-500 rounded-lg" style={{width: '98%'}} />
    </div>
  )
}
