import {Component, memo, useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {composeStories, composeStory, setProjectAnnotations} from '@storybook/react'
import preview from '../../../packages/ui/.storybook/preview'
import {storyUrl} from './Canvas'
import type {Mode} from './theme'
import {closedOverlayArgs, countStories, inlineStoryReason} from './story-policy'

type StoryModule = Parameters<typeof composeStories>[0]
const modules = import.meta.glob<StoryModule>('../../../packages/ui/src/**/*.stories.tsx', {eager: true})
const sources = import.meta.glob<string>('../../../packages/ui/src/**/*.stories.tsx', {
  eager: true,
  query: '?raw',
  import: 'default',
})
setProjectAnnotations(preview)

function composeGroup(
  module: StoryModule,
  mode: Mode,
): {stories: Record<string, ReturnType<typeof composeStory>>; reason: string} {
  try {
    return {
      stories: composeStories(module, {
        ...preview,
        parameters: {...preview.parameters, themes: {themeOverride: mode}},
        initialGlobals: {theme: mode},
      }) as Record<string, ReturnType<typeof composeStory>>,
      reason: '',
    }
  } catch (error) {
    return {stories: {}, reason: String(error)}
  }
}

/** Automatically discovered CSF modules, split by the stories' own navigation titles. */
export const storyGroups = Object.entries(modules)
  .map(([file, module]) => ({
    file,
    module,
    composed: composeGroup(module, 'light'),
    title: String(module.default.title ?? file.split('/').pop()),
    page: String(module.default.title).startsWith('Pages/'),
  }))
  .sort((a, b) => a.title.localeCompare(b.title))

/** Static catalogue totals classified by the same policy used for inline story tiles. */
export const storyTotals = countStories(
  storyGroups.flatMap((group) =>
    Object.values(group.composed.stories).map((Story) => ({
      title: group.title,
      args: Story.args,
      source: sources[group.file] ?? '',
    })),
  ),
)

class StoryBoundary extends Component<{children: ReactNode}, {reason: string}> {
  state = {reason: ''}
  static getDerivedStateFromError(error: Error) {
    return {reason: error.message}
  }
  render() {
    return this.state.reason ? <Fallback reason={this.state.reason} /> : this.props.children
  }
}
function Fallback({reason}: {reason: string}) {
  return (
    <div className="story-fallback" data-story-status="fallback" data-reason={reason}>
      <strong>Renders only in Storybook</strong>
      <p>{reason}</p>
    </div>
  )
}

const StoryGroup = memo(function StoryGroup({group, mode}: {group: (typeof storyGroups)[number]; mode: Mode}) {
  const root = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      {rootMargin: '600px'},
    )
    if (root.current) observer.observe(root.current)
    return () => observer.disconnect()
  }, [])
  const composed = useMemo(() => (mode === 'light' ? group.composed : composeGroup(group.module, mode)), [group, mode])
  return (
    <div className="story-group" ref={root} data-story-group={group.title}>
      <h3>{group.title.replace(/^(Components|Pages)\//, '')}</h3>
      {composed.reason ? (
        <Fallback reason={composed.reason} />
      ) : (
        <div className="story-grid">
          {Object.entries(composed.stories).map(([name, Story]) => (
            <article className="story-tile" key={name} data-story-id={Story.id}>
              <header>
                <span>{Story.storyName ?? name}</span>
                <a href={storyUrl(Story.id)} target="_blank" rel="noreferrer">
                  Storybook ↗
                </a>
              </header>
              {!visible ? (
                <div className="story-pending">Scroll to preview</div>
              ) : inlineStoryReason(group.title, Story.args, sources[group.file] ?? '') ? (
                <Fallback reason={inlineStoryReason(group.title, Story.args, sources[group.file] ?? '')} />
              ) : (
                <StoryBoundary key={mode}>
                  <div className="story-surface" data-story-status="rendered">
                    <Story {...closedOverlayArgs(Story.args)} />
                    {Object.keys(closedOverlayArgs(Story.args)).length > 0 && (
                      <p className="closed-caption">Overlay closed by default · open in Storybook</p>
                    )}
                  </div>
                </StoryBoundary>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  )
})

/** Lazy-mounted story catalogue with original module, story and project decorators. */
export function Stories({page, mode}: {page: boolean; mode: Mode}) {
  return (
    <>
      {storyGroups
        .filter((group) => group.page === page)
        .map((group) => (
          <StoryGroup key={group.file} group={group} mode={mode} />
        ))}
    </>
  )
}
