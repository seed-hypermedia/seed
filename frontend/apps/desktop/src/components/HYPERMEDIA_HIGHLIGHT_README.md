# Hypermedia Highlight System

This system enables cross-window highlighting of hypermedia elements when
hovering over them.

## How It Works

1. When a user hovers over an element with a hypermedia ID, we broadcast that ID
   to all windows
2. Each window listens for these broadcasts and highlights elements with
   matching IDs
3. When the hover ends, a second broadcast is sent to clear highlights

## Implementation Details

### Broadcasting Events

The document-content-provider.tsx contains hover handlers that broadcast events
to all windows:

```jsx
onHoverIn={(id) => {
  console.log('=== BLOCK HOVER EFFECT: hover in', id)
  // @ts-ignore - ipc access
  window.ipc?.broadcast({
    key: 'hypermediaHoverIn',
    id
  })
}}
onHoverOut={(id) => {
  console.log('=== BLOCK HOVER EFFECT: hover out', id)
  // @ts-ignore - ipc access
  window.ipc?.broadcast({
    key: 'hypermediaHoverOut',
    id
  })
}}
```

### Listening for Events

The HypermediaHighlight component, included in the main application layout,
listens for these events and applies highlighting:

```jsx
useEffect(() => {
  // @ts-ignore - window.appWindowEvents might not be defined in types
  const unsubscribe = window.appWindowEvents?.subscribe((event: any) => {
    if (!styleRef.current) return

    if (typeof event === 'object') {
      if (event.key === 'hypermediaHoverIn' && event.id) {
        styleRef.current.textContent = createHighlightCSS(event.id)
      } else if (event.key === 'hypermediaHoverOut') {
        styleRef.current.textContent = ''
      }
    }
  })

  return () => {
    if (unsubscribe) unsubscribe()
  }
}, [highlightColor])
```

### CSS Generation

The system dynamically generates CSS that targets elements with matching IDs:

```jsx
function createHighlightCSS(id: string): string {
  return `
    [data-blockid="${id}"],
    [data-docid="${id}"] {
      background-color: ${highlightColor} !important;
    }
  `
}
```

## Key Files

- **document-content-provider.tsx**: Contains the hover event handlers
- **components/hypermedia-highlight.tsx**: Component that listens for events and
  applies highlights
- **utils/window-events.ts**: Defines the event types
- **app-windows.ts**: Contains the function to broadcast to all windows
- **app-api.ts**: Handles IPC communication
- **preload.ts**: Exposes the broadcast method to the renderer process

## Customization

You can customize the highlight appearance by passing a custom color to the
HypermediaHighlight component:

```jsx
<HypermediaHighlight highlightColor="rgba(0, 128, 255, 0.3)" />
```

## Troubleshooting

- **No highlighting**: Make sure elements have `data-blockid` or `data-docid`
  attributes matching the ID being sent
- **Events not working**: Check browser console for errors in the broadcast
  mechanism
