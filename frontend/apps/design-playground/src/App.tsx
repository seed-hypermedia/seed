import {useEffect, useLayoutEffect, useMemo, useState, type ReactNode} from 'react'
import {Leaf, Menu, X, RotateCcw, Sun, Moon, ArrowUpRight} from 'lucide-react'
import {Text} from '@shm/ui/text'
import themeSource from '@shm/ui/theme.css?raw'
import {Canvas, storybookBase} from './Canvas'
import {Stories, storyTotals} from './Stories'
import {
  colorNames,
  groupColors,
  decodeHash,
  defaultState,
  encodeHash,
  overrideCss,
  parseTheme,
  themeOverrides,
  type ThemeState,
} from './theme'

const theme = parseTheme(themeSource)
const names = colorNames(theme)
const groups = groupColors(names)
const sizes = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'] as const

function ColorControl({
  name,
  value,
  changed,
  reset,
  edit,
}: {
  name: string
  value: string
  changed: boolean
  reset: () => void
  edit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [hex, setHex] = useState('#000000')
  useEffect(() => {
    setDraft(value)
    const probe = document.createElement('span')
    probe.style.color = value
    document.body.append(probe)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = getComputedStyle(probe).color
    ctx.fillRect(0, 0, 1, 1)
    setHex(
      '#' +
        [...ctx.getImageData(0, 0, 1, 1).data]
          .slice(0, 3)
          .map((c) => c.toString(16).padStart(2, '0'))
          .join(''),
    )
    probe.remove()
  }, [value])
  const valid = CSS.supports('color', draft)
  return (
    <div className="token-editor">
      <div>
        <label htmlFor={'token' + name}>
          {changed && <span className="changed-dot" aria-label="Changed" />}
          {name}
        </label>
        {changed && (
          <button onClick={reset} aria-label={'Reset ' + name}>
            ↺
          </button>
        )}
      </div>
      <div>
        <input type="color" aria-label={'Pick ' + name} value={hex} onChange={(e) => edit(e.target.value)} />
        <input
          id={'token' + name}
          value={draft}
          aria-invalid={!valid}
          onChange={(e) => {
            setDraft(e.target.value)
            if (CSS.supports('color', e.target.value)) edit(e.target.value)
          }}
        />
      </div>
      {!valid && <small>Invalid CSS color · not applied</small>}
    </div>
  )
}
function Control({
  name,
  changed,
  reset,
  children,
}: {
  name: string
  changed: boolean
  reset: () => void
  children: ReactNode
}) {
  return (
    <div className="control-field">
      <div>
        <span>
          {changed && <span className="changed-dot" />}
          {name}
        </span>
        {changed && (
          <button aria-label={'Reset ' + name} onClick={reset}>
            ↺
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

/** Token-only controls and one scrolling, automatically synchronized component canvas. */
export function App() {
  const [state, setState] = useState<ThemeState>(() => decodeHash(location.hash, theme) ?? defaultState())
  const [compare, setCompare] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')
  const overrides = useMemo(() => themeOverrides(theme, state), [state])
  const css = useMemo(() => overrideCss(overrides, theme), [overrides])
  const changed = new Set(
    (['light', 'dark'] as const).flatMap((mode) =>
      Object.entries(overrides[mode])
        .filter(([name, value]) => value !== (theme[mode][name] ?? theme.light[name]))
        .map(([name]) => name),
    ),
  ).size
  const update = (patch: Partial<ThemeState>) => setState((previous) => ({...previous, ...patch}))
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', state.mode === 'dark')
  }, [state.mode])
  useEffect(() => {
    const restore = () => {
      const next = decodeHash(location.hash, theme)
      if (next) setState(next)
    }
    const release = () => setCompare(false)
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPanelOpen(false)
        release()
      }
    }
    addEventListener('hashchange', restore)
    addEventListener('blur', release)
    addEventListener('pointerup', release)
    addEventListener('keydown', keyboard)
    return () => {
      removeEventListener('hashchange', restore)
      removeEventListener('blur', release)
      removeEventListener('pointerup', release)
      removeEventListener('keydown', keyboard)
    }
  }, [])
  const matches = (name: string) => name.toLowerCase().includes(search.toLowerCase())
  const numeric = (
    key: 'baseSize' | 'typeRatio' | 'lineHeight' | 'spacing' | 'shadow' | 'duration',
    label: string,
    min: number,
    max: number,
    step: number,
  ) => {
    const value = state[key] ?? defaultState()[key]!
    return !matches(label + ' ' + key) ? null : (
      <Control name={label} changed={value !== defaultState()[key]} reset={() => update({[key]: defaultState()[key]})}>
        <label>
          <input
            aria-label={label}
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => update({[key]: Number(e.target.value)})}
          />
          <output>{value}</output>
        </label>
      </Control>
    )
  }
  return (
    <>
      <style id="playground-overrides">{compare ? '' : css}</style>
      {panelOpen && (
        <button className="panel-scrim" aria-label="Close token controls" onClick={() => setPanelOpen(false)} />
      )}
      <aside className={'control-panel ' + (panelOpen ? 'is-open' : '')}>
        <header className="panel-brand">
          <Leaf size={21} />
          <strong>
            Seed <span>tokens</span>
          </strong>
          <button className="mobile-controls" aria-label="Close token controls" onClick={() => setPanelOpen(false)}>
            <X size={18} />
          </button>
        </header>
        <div className="panel-toolbar">
          <div className="mode-switch">
            {(['light', 'dark'] as const).map((mode) => (
              <button key={mode} aria-pressed={state.mode === mode} onClick={() => update({mode})}>
                {mode === 'light' ? <Sun size={14} /> : <Moon size={14} />} {mode}
              </button>
            ))}
          </div>
          <input
            className="token-search"
            aria-label="Filter tokens"
            placeholder="Search tokens…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="change-count">
            <span>{changed} changed</span>
            <button onClick={() => setState({...defaultState(), mode: state.mode})}>
              <RotateCcw size={12} />
              Reset all
            </button>
          </div>
        </div>
        <div className="panel-scroll">
          <details className="panel-section" open>
            <summary>Colors</summary>
            {matches('brand hue') && (
              <Control name="Brand hue" changed={state.hue !== null} reset={() => update({hue: null})}>
                <div className="brand-presets">
                  {[
                    {name: 'Seed', hue: null},
                    {name: 'Ocean', hue: 250},
                    {name: 'Iris', hue: 300},
                    {name: 'Clay', hue: 40},
                    {name: 'Rose', hue: 10},
                  ].map(({name, hue}) => (
                    <button key={name} aria-pressed={state.hue === hue} onClick={() => update({hue})}>
                      {name}
                    </button>
                  ))}
                </div>
                <input
                  aria-label="Brand hue"
                  type="range"
                  min="0"
                  max="360"
                  value={state.hue ?? 177}
                  onChange={(e) => update({hue: Number(e.target.value)})}
                />
              </Control>
            )}
            {matches('neutral base') && (
              <Control name="Neutral base" changed={!!state.neutral} reset={() => update({neutral: ''})}>
                <select
                  aria-label="Neutral base"
                  value={state.neutral}
                  onChange={(e) => update({neutral: e.target.value})}
                >
                  {['', 'neutral', 'slate', 'stone', 'zinc'].map((value) => (
                    <option key={value} value={value}>
                      {value || 'Seed default'}
                    </option>
                  ))}
                </select>
              </Control>
            )}
            {Object.entries(groups)
              .filter(([, tokens]) => !search || tokens.some(matches))
              .map(([group, tokens]) => (
                <details className="token-group" key={group} open={!!search}>
                  <summary>
                    {group}
                    <span>{tokens.filter(matches).length}</span>
                  </summary>
                  {tokens.filter(matches).map((name) => (
                    <ColorControl
                      key={state.mode + name}
                      name={name}
                      value={overrides[state.mode][name] ?? theme[state.mode][name] ?? theme.light[name]!}
                      changed={
                        (overrides[state.mode][name] ?? theme[state.mode][name] ?? theme.light[name]) !==
                        (theme[state.mode][name] ?? theme.light[name])
                      }
                      edit={(value) =>
                        setState((previous) => ({
                          ...previous,
                          overrides: {
                            ...previous.overrides,
                            [state.mode]: {...previous.overrides[state.mode], [name]: value},
                          },
                        }))
                      }
                      reset={() =>
                        setState((previous) => ({
                          ...previous,
                          overrides: {
                            ...previous.overrides,
                            [state.mode]: {
                              ...previous.overrides[state.mode],
                              [name]: theme[state.mode][name] ?? theme.light[name]!,
                            },
                          },
                        }))
                      }
                    />
                  ))}
                </details>
              ))}
            {search && !names.some(matches) && <p className="empty-search">No matching colors</p>}
          </details>
          <details className="panel-section" open>
            <summary>Typography</summary>
            {(['sans', 'serif', 'mono'] as const).map(
              (font) =>
                matches(font + ' font --font-' + font) && (
                  <Control key={font} name={font + ' font'} changed={!!state[font]} reset={() => update({[font]: ''})}>
                    <select
                      aria-label={font + ' font'}
                      value={state[font] ?? ''}
                      onChange={(e) => update({[font]: e.target.value})}
                    >
                      <option value="">Seed default</option>
                      {(font === 'sans'
                        ? ['Verdana, sans-serif', 'Arial, sans-serif', "'Trebuchet MS', sans-serif"]
                        : font === 'serif'
                          ? ['Georgia, serif', "'Times New Roman', serif"]
                          : ["'Courier New', monospace", 'Consolas, monospace']
                      ).map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </Control>
                ),
            )}
            {numeric('baseSize', 'Base font size', 12, 24, 1)}
            {numeric('typeRatio', 'Type scale ratio', 1.05, 1.5, 0.01)}
            {numeric('lineHeight', 'Line height', 1.2, 2, 0.05)}
          </details>
          <details className="panel-section" open>
            <summary>Spacing</summary>
            {numeric('spacing', '--spacing', 2, 8, 0.5)}
          </details>
          <details className="panel-section" open>
            <summary>Shape</summary>
            {matches('radius') && (
              <Control
                name="--radius"
                changed={!!state.radius && state.radius !== '0.375'}
                reset={() => update({radius: ''})}
              >
                <div className="radius-presets">
                  {['0', '0.25', '0.375', '0.5', '0.75', '1'].map((radius) => (
                    <button
                      key={radius}
                      aria-label={radius + 'rem radius'}
                      aria-pressed={(state.radius || '0.375') === radius}
                      onClick={() => update({radius})}
                    >
                      {radius}
                    </button>
                  ))}
                </div>
              </Control>
            )}
          </details>
          <details className="panel-section" open>
            <summary>Elevation</summary>
            {numeric('shadow', 'Shadow strength', 0, 2, 0.1)}
          </details>
          <details className="panel-section" open>
            <summary>Motion</summary>
            {numeric('duration', '--duration-normal', 0, 1000, 50)}
          </details>
        </div>
        <footer className="panel-bottom">
          <button
            className="compare-button"
            aria-pressed={compare}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              setCompare(true)
            }}
            onPointerUp={() => setCompare(false)}
            onPointerCancel={() => setCompare(false)}
            onLostPointerCapture={() => setCompare(false)}
            onKeyDown={(event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault()
                setCompare(true)
              }
            }}
            onKeyUp={(event) => {
              if (event.key === ' ' || event.key === 'Enter') setCompare(false)
            }}
            onBlur={() => setCompare(false)}
          >
            {compare ? 'Original theme' : 'Hold to compare'}
          </button>
          <button
            className="share-button"
            onClick={async () => {
              history.replaceState(null, '', encodeHash(state))
              try {
                await navigator.clipboard.writeText(location.href)
                setNotice('Share link copied')
              } catch {
                setNotice('Share this page’s URL from the address bar')
              }
            }}
          >
            Share <ArrowUpRight size={14} />
          </button>
        </footer>
      </aside>
      <div className="playground-main">
        <header className="playground-header">
          <div>
            <button className="mobile-controls" aria-label="Open token controls" onClick={() => setPanelOpen(true)}>
              <Menu size={19} />
            </button>
            <Leaf size={20} />
            <strong>Design playground</strong>
          </div>
          <a href={storybookBase} target="_blank" rel="noreferrer">
            Storybook ↗
          </a>
        </header>
        <nav className="section-index" aria-label="Canvas sections">
          {['Foundations', 'Components', 'Page modules', 'Compositions'].map((name) => (
            <a key={name} href={'#' + name.toLowerCase().replaceAll(' ', '-')}>
              {name}
            </a>
          ))}
          <span>
            {storyTotals.total} stories · {storyTotals.storybookOnly} Storybook-only
          </span>
        </nav>
        {notice && (
          <div className="workbench-notice" role="status">
            {notice}
            <button aria-label="Dismiss" onClick={() => setNotice('')}>
              ×
            </button>
          </div>
        )}
        <main>
          <section id="foundations" className="canvas-section">
            <h2>Foundations</h2>
            <div className="foundation-grid">
              <article className="foundation-card">
                <h3>Type scale</h3>
                {sizes.map((size) => (
                  <Text key={size} size={size} className="block">
                    Type {size} · Aa 0123
                  </Text>
                ))}
                <Text family="serif" className="block">
                  Serif · Design notes
                </Text>
                <Text family="mono" className="block">
                  Mono · seed.tokens
                </Text>
              </article>
              <article className="foundation-card">
                <h3>Spacing</h3>
                <div className="flex flex-col gap-3">
                  {[1, 2, 3, 4, 6, 8, 12].map((n) => (
                    <div key={n} className="spacing-specimen">
                      <code>{n}</code>
                      <span style={{width: 'calc(var(--spacing) * ' + n + ')'}} />
                    </div>
                  ))}
                </div>
              </article>
              <article className="foundation-card">
                <h3>Shape & elevation</h3>
                <div className="flex flex-wrap gap-4">
                  {(['sm', 'md', 'lg', 'xl'] as const).map((size) => (
                    <div
                      key={size}
                      className="shape-specimen p-4"
                      style={{
                        borderRadius: 'calc(var(--radius) + ' + {sm: -4, md: -2, lg: 0, xl: 4}[size] + 'px)',
                        boxShadow: 'var(--shadow-' + size + ')',
                      }}
                    >
                      {size}
                    </div>
                  ))}
                </div>
                <Text className="mt-6 block" size="sm">
                  Radius and shadow tokens
                </Text>
              </article>
            </div>
            <h3 className="subheading">Color tokens · {names.length}</h3>
            <div className="foundation-swatches">
              {names.map((name) => (
                <div key={name}>
                  <span style={{background: 'var(' + name + ')'}} />
                  <code>{name}</code>
                </div>
              ))}
            </div>
          </section>
          <section id="components" className="canvas-section">
            <h2>Components</h2>
            <Stories page={false} mode={state.mode} />
          </section>
          <section id="page-modules" className="canvas-section">
            <h2>Page modules</h2>
            <Stories page mode={state.mode} />
          </section>
          <section id="compositions" className="canvas-section">
            <h2>Compositions</h2>
            <Canvas />
          </section>
        </main>
      </div>
    </>
  )
}
