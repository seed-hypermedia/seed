import z from 'zod'
// @ts-expect-error ignore this import error
import {appStore} from './app-store.mts'
import {t} from './app-trpc'

const UI_PREFERENCES_STORAGE_KEY = 'UIPreferences-v001'

const sidebarSectionIds = ['joined-sites', 'following', 'bookmarks', 'library', 'drafts'] as const
type SidebarSectionId = (typeof sidebarSectionIds)[number]

const sidebarSectionIdSchema = z.enum(sidebarSectionIds)

type SidebarSectionPrefs = {
  collapsed: boolean
  visible: boolean
  sortMode: 'activity' | 'alphabetical' | 'manual'
  itemOrder: string[]
}

export type UIPreferencesState = {
  sidebar: {
    sectionOrder: SidebarSectionId[]
    sections: Partial<Record<SidebarSectionId, Partial<SidebarSectionPrefs>>>
  }
}

const DEFAULT_STATE: UIPreferencesState = {
  sidebar: {
    sectionOrder: ['joined-sites', 'following', 'bookmarks', 'library', 'drafts'],
    sections: {},
  },
}

function loadUIPreferences(): UIPreferencesState {
  const stored = appStore.get(UI_PREFERENCES_STORAGE_KEY) as UIPreferencesState | undefined
  if (!stored) return {...DEFAULT_STATE}
  // Ensure sectionOrder has all known sections (new sections added in future)
  const order = stored.sidebar?.sectionOrder || DEFAULT_STATE.sidebar.sectionOrder
  const missing = sidebarSectionIds.filter((id) => !order.includes(id))
  return {
    sidebar: {
      sectionOrder: [...order, ...missing],
      sections: stored.sidebar?.sections || {},
    },
  }
}

let state: UIPreferencesState = loadUIPreferences()

function writeUIPreferences(newState: UIPreferencesState) {
  state = newState
  appStore.set(UI_PREFERENCES_STORAGE_KEY, newState)
}

export const uiPreferencesApi = t.router({
  get: t.procedure.query(async () => {
    return state
  }),

  setSidebarSectionPrefs: t.procedure
    .input(
      z.object({
        sectionId: sidebarSectionIdSchema,
        prefs: z.object({
          collapsed: z.boolean().optional(),
          visible: z.boolean().optional(),
          sortMode: z.enum(['activity', 'alphabetical', 'manual']).optional(),
          itemOrder: z.array(z.string()).optional(),
        }),
      }),
    )
    .mutation(async ({input}) => {
      const existing = state.sidebar.sections[input.sectionId] || {}
      writeUIPreferences({
        ...state,
        sidebar: {
          ...state.sidebar,
          sections: {
            ...state.sidebar.sections,
            [input.sectionId]: {...existing, ...input.prefs},
          },
        },
      })
      return undefined
    }),

  setSidebarSectionOrder: t.procedure.input(z.array(sidebarSectionIdSchema)).mutation(async ({input}) => {
    writeUIPreferences({
      ...state,
      sidebar: {
        ...state.sidebar,
        sectionOrder: input,
      },
    })
    return undefined
  }),

  setSidebarItemOrder: t.procedure
    .input(
      z.object({
        sectionId: sidebarSectionIdSchema,
        itemOrder: z.array(z.string()),
      }),
    )
    .mutation(async ({input}) => {
      const existing = state.sidebar.sections[input.sectionId] || {}
      writeUIPreferences({
        ...state,
        sidebar: {
          ...state.sidebar,
          sections: {
            ...state.sidebar.sections,
            [input.sectionId]: {...existing, itemOrder: input.itemOrder, sortMode: 'manual'},
          },
        },
      })
      return undefined
    }),

  resetSidebar: t.procedure.mutation(async () => {
    writeUIPreferences({...DEFAULT_STATE, sidebar: {...DEFAULT_STATE.sidebar, sections: {}}})
    return undefined
  }),
})
