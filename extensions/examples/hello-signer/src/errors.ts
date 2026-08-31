import {ExtensionError} from '@seed-hypermedia/extension-sdk'

/** Turn a bridge error into a sentence a person can act on. */
export function describeError(error: unknown): string {
  if (error instanceof ExtensionError) {
    switch (error.code) {
      case 'user_rejected':
        return 'You cancelled the request in the confirmation dialog.'
      case 'not_signed_in':
        return 'Sign in to the site first, then try again.'
      case 'permission_denied':
        return `This extension is not allowed to do that (${error.message}).`
      case 'not_supported':
        return `Not supported here: ${error.message}`
      default:
        return `${error.code}: ${error.message}`
    }
  }
  return error instanceof Error ? error.message : String(error)
}
