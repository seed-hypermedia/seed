import {useEffect, useLayoutEffect, useMemo, useState} from 'react'
import {ArrowUpRight, Check, Copy, Leaf, Menu, Moon, RotateCcw, Shuffle, SlidersHorizontal, Sun, X} from 'lucide-react'
import themeSource from '@shm/ui/theme.css?raw'
import {Canvas, storybookBase} from './Canvas'
import {
  colorNames,
  contrastRatio,
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
const presets = [
  {name: 'Seed', hue: null, color: '#198576'},
  {name: 'Ocean', hue: 250, color: '#467bd8'},
  {name: 'Iris', hue: 300, color: '#9969c8'},
  {name: 'Clay', hue: 40, color: '#b66d50'},
  {name: 'Rose', hue: 10, color: '#bf5c78'},
]
const pairs = [
  ['foreground', 'background'],
  ['primary-foreground', 'primary'],
  ['muted-foreground', 'background'],
  ['card-foreground', 'card'],
  ['destructive-foreground', 'destructive'],
  ['link', 'background'],
]

function TokenEditor({
  name,
  value,
  hex,
  onChange,
  onClear,
  edited,
}: {
  name: string
  value: string
  hex: string
  onChange: (value: string) => void
  onClear: () => void
  edited: boolean
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const valid = CSS.supports('color', draft)
  return (
    <div className="token-editor">
      <div>
        <label htmlFor={'token-' + name}>{name}</label>
        {edited && (
          <button onClick={onClear} aria-label={'Reset ' + name}>
            ↺
          </button>
        )}
      </div>
      <div>
        <input
          aria-label={'Pick ' + name}
          type="color"
          value={hex}
          onChange={(event) => {
            setDraft(event.target.value)
            onChange(event.target.value)
          }}
        />
        <input
          id={'token-' + name}
          value={draft}
          aria-invalid={!valid}
          onChange={(event) => {
            setDraft(event.target.value)
            if (CSS.supports('color', event.target.value)) onChange(event.target.value)
          }}
        />
      </div>
      {!valid && <small>Enter a valid CSS color.</small>}
    </div>
  )
}

/** Single-page theme workbench with shareable settings and live component previews. */
export function App() {
  const [initial] = useState(() => decodeHash(window.location.hash, theme))
  const [state, setState] = useState<ThemeState>(() => initial ?? defaultState())
  const [panelOpen, setPanelOpen] = useState(false)
  const [notice, setNotice] = useState(() =>
    window.location.hash.startsWith('#theme=') && !initial
      ? 'That theme link could not be read. Showing Seed defaults.'
      : '',
  )
  const [filter, setFilter] = useState('')
  const [colors, setColors] = useState<Record<string, string>>({})
  const [checks, setChecks] = useState<{label: string; ratio: number}[]>([])
  const overrides = useMemo(() => themeOverrides(theme, state), [state])
  const css = useMemo(() => overrideCss(overrides, theme), [overrides])
  const update = (patch: Partial<ThemeState>) => setState((previous) => ({...previous, ...patch}))

  useEffect(() => {
    const restore = () => {
      const next = decodeHash(window.location.hash, theme)
      if (next) {
        setState(next)
        setNotice('Shared theme restored.')
      } else if (!window.location.hash) {
        setState(defaultState())
        setNotice('')
      } else setNotice('That theme link could not be read. Your current theme is unchanged.')
    }
    window.addEventListener('hashchange', restore)
    return () => window.removeEventListener('hashchange', restore)
  }, [])

  useEffect(() => {
    if (!panelOpen) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanelOpen(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [panelOpen])

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', state.mode === 'dark')
    document.documentElement.style.colorScheme = state.mode
    const probe = document.createElement('span')
    probe.style.display = 'none'
    document.body.append(probe)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', {willReadFrequently: true})!
    const rgb: Record<string, number[]> = {}
    const hex: Record<string, string> = {}
    for (const name of names) {
      probe.style.color = 'var(' + name + ')'
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = getComputedStyle(probe).color
      context.fillRect(0, 0, 1, 1)
      const pixel = Array.from(context.getImageData(0, 0, 1, 1).data)
      rgb[name] = [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]! / 255]
      hex[name] =
        '#' +
        pixel
          .slice(0, 3)
          .map((channel) => channel.toString(16).padStart(2, '0'))
          .join('')
    }
    probe.remove()
    setColors(hex)
    setChecks(
      pairs.map(([foreground, background]) => ({
        label: foreground + ' / ' + background,
        ratio: contrastRatio(rgb['--' + foreground]!, rgb['--' + background]!),
      })),
    )
  }, [css, state.mode])

  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setNotice(message)
    } catch {
      setNotice('Clipboard unavailable. Select and copy the text below.')
      setExportText(text)
    }
  }
  const [exportText, setExportText] = useState('')
  const reset = () => {
    setState(defaultState())
    history.replaceState(null, '', window.location.pathname + window.location.search)
    setNotice('Back to the original Seed theme.')
    setExportText('')
  }
  const shuffle = () => {
    setState({
      ...defaultState(),
      mode: state.mode,
      hue: Math.floor(Math.random() * 360),
      neutral: ['slate', 'stone', 'zinc'][Math.floor(Math.random() * 3)]!,
      radius: ['0', '0.25', '0.5', '0.75', '1'][Math.floor(Math.random() * 5)]!,
      shadow: Number((Math.random() * 2).toFixed(1)),
    })
    setNotice('A fresh perspective.')
  }
  return (
    <>
      <style id="playground-overrides">{css}</style>
      {panelOpen && (
        <button className="panel-scrim" onClick={() => setPanelOpen(false)} aria-label="Close theme controls" />
      )}
      <aside className={'control-panel ' + (panelOpen ? 'is-open' : '')} aria-label="Theme controls">
        <div className="panel-top">
          <a href="./" className="panel-brand">
            <Leaf size={19} />
            <span>
              Seed <em>studio</em>
            </span>
          </a>
          <button className="panel-close" onClick={() => setPanelOpen(false)} aria-label="Close controls">
            <X size={18} />
          </button>
          <span className="panel-version">01</span>
        </div>
        <div className="panel-scroll">
          <div className="panel-section">
            <div className="control-heading">
              <span>Appearance</span>
              <span>◐</span>
            </div>
            <div className="mode-control">
              {(['light', 'dark'] as const).map((mode) => (
                <button key={mode} aria-pressed={state.mode === mode} onClick={() => update({mode})}>
                  {mode === 'light' ? <Sun size={14} /> : <Moon size={14} />} {mode === 'light' ? 'Light' : 'Dark'}
                </button>
              ))}
            </div>
          </div>
          <div className="panel-section">
            <div className="control-heading">
              <span>Brand color</span>
              <span>{state.hue === null ? 'Seed green' : Math.round(state.hue) + '°'}</span>
            </div>
            <div className="brand-presets">
              {presets.map((preset) => (
                <button
                  key={preset.name}
                  title={preset.name}
                  aria-label={preset.name + ' brand'}
                  aria-pressed={state.hue === preset.hue}
                  onClick={() => update({hue: preset.hue})}
                >
                  <span style={{background: preset.color}}>{state.hue === preset.hue && <Check size={14} />}</span>
                  <small>{preset.name}</small>
                </button>
              ))}
            </div>
            <input
              className="hue-slider"
              aria-label="Brand hue"
              type="range"
              min="0"
              max="360"
              value={state.hue ?? 177}
              onChange={(event) => update({hue: Number(event.target.value)})}
            />
          </div>
          <div className="panel-section">
            <label className="control-field">
              <span>Neutral base</span>
              <select value={state.neutral} onChange={(event) => update({neutral: event.target.value})}>
                <option value="">Neutral · Seed default</option>
                <option value="neutral">Neutral</option>
                <option value="slate">Slate</option>
                <option value="stone">Stone</option>
                <option value="zinc">Zinc</option>
              </select>
            </label>
            <div className="control-heading">
              <span>Corner radius</span>
              <span>{state.radius || '0.375'}rem</span>
            </div>
            <div className="radius-presets">
              {['0', '0.25', '0.375', '0.5', '0.75', '1'].map((radius) => (
                <button
                  key={radius}
                  aria-pressed={(state.radius || '0.375') === radius}
                  onClick={() => update({radius})}
                  aria-label={radius + 'rem radius'}
                >
                  <span style={{borderTopLeftRadius: radius + 'rem'}} />
                  {radius}
                </button>
              ))}
            </div>
          </div>
          <div className="panel-section">
            <label className="control-field">
              <span>
                Sans serif <span>Aa</span>
              </span>
              <select value={state.sans} onChange={(event) => update({sans: event.target.value})}>
                <option value="">System · Seed default</option>
                <option value="Verdana, sans-serif">Verdana</option>
                <option value="'Trebuchet MS', sans-serif">Trebuchet</option>
                <option value="'Helvetica Neue', Helvetica, sans-serif">Helvetica</option>
              </select>
            </label>
            <label className="control-field">
              <span>
                Serif <span className="serif-mark">Aa</span>
              </span>
              <select value={state.serif} onChange={(event) => update({serif: event.target.value})}>
                <option value="">Seed default</option>
                <option value="Georgia, serif">Georgia</option>
                <option value="Palatino, 'Palatino Linotype', serif">Palatino</option>
                <option value="'Times New Roman', serif">Times</option>
              </select>
            </label>
            <label className="control-field">
              <span>
                Shadow strength <span>{state.shadow.toFixed(1)}×</span>
              </span>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={state.shadow}
                onChange={(event) => update({shadow: Number(event.target.value)})}
              />
            </label>
          </div>
          <details className="panel-section advanced">
            <summary>
              All tokens <span>Advanced ↗</span>
            </summary>
            <p>Editing {state.mode} mode. Direct edits win over presets.</p>
            <input
              className="token-search"
              aria-label="Filter color tokens"
              placeholder="Find a color token…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            {names
              .filter((name) => name.includes(filter))
              .map((name) => (
                <TokenEditor
                  key={state.mode + name}
                  name={name}
                  value={overrides[state.mode][name] ?? theme[state.mode][name] ?? theme.light[name]!}
                  hex={colors[name] || '#000000'}
                  edited={!!state.overrides[state.mode][name]}
                  onClear={() =>
                    setState((previous) => {
                      const next = {...previous.overrides[state.mode]}
                      delete next[name]
                      return {...previous, overrides: {...previous.overrides, [state.mode]: next}}
                    })
                  }
                  onChange={(value) =>
                    setState((previous) => ({
                      ...previous,
                      overrides: {
                        ...previous.overrides,
                        [state.mode]: {...previous.overrides[state.mode], [name]: value},
                      },
                    }))
                  }
                />
              ))}
          </details>
        </div>
        <div className="panel-bottom">
          <div className="panel-action-row">
            <button onClick={reset}>
              <RotateCcw size={14} />
              Reset
            </button>
            <button onClick={shuffle}>
              <Shuffle size={14} />
              Shuffle
            </button>
          </div>
          <button
            className="copy-css"
            onClick={() => copy(css || '/* No overrides — using the shared Seed theme. */', 'Override CSS copied.')}
          >
            <Copy size={14} />
            Copy CSS <span>↗</span>
          </button>
          <button
            className="share-link"
            onClick={() => {
              const hash = encodeHash(state)
              history.replaceState(null, '', hash)
              void copy(window.location.href, 'Theme link copied.')
            }}
          >
            Share this theme <ArrowUpRight size={14} />
          </button>
        </div>
      </aside>
      <div className="playground-main">
        <header className="playground-header">
          <div className="header-wordmark">
            <button className="mobile-controls" onClick={() => setPanelOpen(true)} aria-label="Open theme controls">
              <Menu size={20} />
            </button>
            <Leaf size={21} />
            <span>Seed</span>
            <span className="header-slash">/</span>
            <span className="header-subtitle">Design playground</span>
          </div>
          <a href={storybookBase} target="_blank" rel="noreferrer">
            Storybook
            <ArrowUpRight size={15} />
          </a>
        </header>
        <main>
          <div className="canvas-heading">
            <div>
              <div className="eyebrow">A WORKBENCH FOR THE DETAILS</div>
              <h1>
                Make it feel like <span>you.</span>
              </h1>
              <p>One theme. Every little possibility.</p>
            </div>
            <button
              className="theme-toggle"
              onClick={() => update({mode: state.mode === 'light' ? 'dark' : 'light'})}
              aria-label={'Switch to ' + (state.mode === 'light' ? 'dark' : 'light') + ' mode'}
            >
              {state.mode === 'light' ? <Moon size={17} /> : <Sun size={17} />}
              <span>{state.mode === 'light' ? 'Light canvas' : 'Dark canvas'}</span>
            </button>
            <button className="mobile-controls mobile-theme" onClick={() => setPanelOpen(true)}>
              <SlidersHorizontal size={16} />
              Theme
            </button>
          </div>
          {notice && (
            <div className="workbench-notice" role="status">
              {notice}
              <button onClick={() => setNotice('')} aria-label="Dismiss notification">
                <X size={14} />
              </button>
            </div>
          )}
          {exportText && (
            <label className="clipboard-fallback">
              Copy manually
              <textarea readOnly value={exportText} onFocus={(event) => event.target.select()} />
              <button onClick={() => setExportText('')}>Close</button>
            </label>
          )}
          <Canvas colors={colors} checks={checks} />
          <footer className="canvas-footer">
            <Leaf size={15} />
            <span>Made of the same things as Seed.</span>
            <a href={storybookBase} target="_blank" rel="noreferrer">
              Explore the whole system ↗
            </a>
          </footer>
        </main>
      </div>
    </>
  )
}
