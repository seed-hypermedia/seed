# Hypermedia Hover Implementation Guide

This document provides a comprehensive overview of the implementation details for the cross-window highlighting system for Hypermedia IDs.

## System Architecture

The system consists of several interconnected components:

### 1. Electron IPC Communication

The core of the cross-window communication is built on Electron's IPC (Inter-Process Communication) system:

- **Main Process** (`app-windows.ts`, `app-api.ts`): Responsible for managing all application windows and broadcasting messages between them.
- **Renderer Processes** (`preload.ts`): Each window has a preload script that exposes IPC methods to the renderer.

### 2. Event Definitions

The `window-events.ts` file defines the event types and provides React hooks for sending and listening to events:

- `hypermediaHoverIn`: Sent when hovering over an element with a hypermedia ID
- `hypermediaHoverOut`: Sent when the mouse leaves an element with a hypermedia ID

### 3. CSS Management

The `hypermedia-hover.tsx` file includes components and hooks for managing CSS styles:

- `HypermediaHoverManager`: Handles listening for events and updating styles
- `useHypermediaHover`: Hook for implementing hover behavior in components

## Main Files & Responsibilities

### `app-windows.ts`

Contains the `dispatchAllWindowsAppEvent` function that broadcasts messages to all open windows:

```typescript
export function dispatchAllWindowsAppEvent(event: AppWindowEvent) {
  allWindows.forEach((window) => {
    window.webContents.send('appWindowEvent', event)
  })
}
```

### `app-api.ts`

Sets up the IPC handler for broadcasts:

```typescript
ipcMain.on('broadcastWindowEvent', (_event, info) => {
  dispatchAllWindowsAppEvent(info)
})
```

### `preload.ts`

Exposes the broadcast method to renderer processes:

```typescript
contextBridge.exposeInMainWorld('ipc', {
  // ...other methods
  broadcast: (event: AppWindowEvent) => {
    ipcRenderer.send('broadcastWindowEvent', event)
  },
})
```

### `window-events.ts`

Defines event types and provides React hooks:

```typescript
export type AppWindowEvent =
  // ... other events
  | {key: 'hypermediaHoverIn'; hypermediaId: string}
  | {key: 'hypermediaHoverOut'; hypermediaId: string}

export function useBroadcastHypermediaHover() {
  const ipc = useIPC()
  return {
    hoverIn: (hypermediaId: string) => {
      ipc.broadcast({ key: 'hypermediaHoverIn', hypermediaId })
    },
    hoverOut: (hypermediaId: string) => {
      ipc.broadcast({ key: 'hypermediaHoverOut', hypermediaId })
    }
  }
}

export function useListenHypermediaHover(
  callback: {
    onHoverIn: (hypermediaId: string) => void;
    onHoverOut: (hypermediaId: string) => void;
  }
) {
  // Implementation to listen for events
}
```

### `hypermedia-hover.tsx`

Provides the UI components and CSS management:

```typescript
export function HypermediaHoverManager({ 
  highlightColor = DEFAULT_HIGHLIGHT_COLOR 
}: HypermediaHoverManagerProps) {
  const styleRef = useRef<HTMLStyleElement | null>(null)
  
  // Create the style element
  useEffect(() => {
    // Initialize style element
  }, [])
  
  // Listen for hover events
  useListenHypermediaHover({
    onHoverIn: (hypermediaId) => {
      // Add CSS to highlight elements
    },
    onHoverOut: (_hypermediaId) => {
      // Remove CSS
    }
  })
  
  return null
}
```

## Workflow

1. **Initialization**:
   - The `HypermediaHoverManager` component is added to the main application layout
   - It creates a style element in the document head

2. **Hover In**:
   - User hovers over a component using the `useHypermediaHover` hook
   - The hook triggers `hypermediaHoverIn` event with the hypermedia ID
   - The event is broadcast to all windows
   - Each window's `HypermediaHoverManager` receives the event and updates its style element

3. **Hover Out**:
   - User's mouse leaves the component
   - The hook triggers `hypermediaHoverOut` event
   - All windows clear their highlight styles

## Testing the Implementation

To test the hypermedia hover system:

1. Run the application with multiple windows open
2. Use the `HypermediaElement` component from `components/hypermedia-hover-example.tsx`
3. Observe that hovering over elements in one window highlights matching elements in all windows

## Troubleshooting

Common issues and solutions:

- **Styles not applying**: Check that the selector matches elements in the DOM (e.g., `data-blockid` or `data-docid` attributes)
- **Events not reaching other windows**: Verify that the broadcast IPC system is working
- **Style conflicts**: The system uses `!important` to override other styles; check if there are other important styles

## Future Improvements

Potential enhancements:

1. **Customizable highlight styles**: Allow more styling options beyond just background color
2. **Animation effects**: Add fade-in/fade-out animations for smoother transitions
3. **Selective broadcasting**: Target specific windows instead of broadcasting to all
4. **Connection visualization**: Draw lines or arrows between related elements 