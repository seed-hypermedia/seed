import {useBlockNote} from '@/blocknote/react'
import {HMBlockSchema} from './schema'

export type HyperMediaEditor = ReturnType<typeof useBlockNote<HMBlockSchema>>
