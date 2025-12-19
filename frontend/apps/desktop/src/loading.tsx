// import React, {useEffect, useState} from 'react'
// import ReactDOM from 'react-dom/client'

// // Local type definitions to avoid importing daemon.ts (which has tRPC dependencies)
// type GoDaemonState =
//   | {t: 'startup'}
//   | {t: 'ready'}
//   | {t: 'error'; message: string}

// type StateStream<T> = {
//   subscribe: (listener: (value: T) => void) => () => void
// }

// // Type declarations for loading window globals
// declare global {
//   interface Window {
//     daemonState?: StateStream<GoDaemonState>
//     windowIsReady?: () => void
//   }
// }

// console.log('[LOADING WINDOW]: loading.tsx executing')

// function LoadingWindow() {
//   console.log('[LOADING WINDOW]: LoadingWindow component rendering')

//   const [daemonState, setDaemonState] = useState<GoDaemonState>({t: 'startup'})
//   const [testMode, setTestMode] = useState(false)
//   const [testStateIndex, setTestStateIndex] = useState(0)

//   // Test states for cycling through
//   const testStates: GoDaemonState[] = [
//     {t: 'startup'},
//     {t: 'ready'},
//     {t: 'error', message: 'Test error message'},
//   ]

//   useEffect(() => {
//     console.log('[LOADING WINDOW]: Setting up daemon state subscription')
//     const unsubscribe = window.daemonState?.subscribe((state: GoDaemonState) => {
//       console.log('[LOADING WINDOW]: Daemon state update:', state)
//       if (!testMode) {
//         setDaemonState(state)
//       }
//     })
//     return () => unsubscribe?.()
//   }, [testMode])

//   useEffect(() => {
//     console.log('[LOADING WINDOW]: Calling windowIsReady')
//     window.windowIsReady?.()
//   }, [])

//   const getMessage = () => {
//     const state = testMode ? testStates[testStateIndex] : daemonState

//     if (state.t === 'error') {
//       return `Error: ${state.message}`
//     }
//     if (state.t === 'ready') {
//       return 'Starting Seed...'
//     }
//     return 'Starting Seed...'
//   }

//   const handleTestToggle = () => {
//     console.log('[LOADING WINDOW]: Test button clicked')
//     if (!testMode) {
//       setTestMode(true)
//       setTestStateIndex(0)
//     } else {
//       const nextIndex = (testStateIndex + 1) % testStates.length
//       if (nextIndex === 0) {
//         setTestMode(false)
//       } else {
//         setTestStateIndex(nextIndex)
//       }
//     }
//   }

//   const displayState = testMode ? testStates[testStateIndex] : daemonState

//   return (
//     <div
//       style={{
//         width: '100%',
//         height: '100%',
//         display: 'flex',
//         flexDirection: 'column',
//         alignItems: 'center',
//         justifyContent: 'center',
//         gap: '1rem',
//         backgroundColor: '#1e1e1e',
//         color: '#ffffff',
//         position: 'relative',
//       }}
//     >
//       {/* Simple spinner */}
//       <div
//         style={{
//           width: '40px',
//           height: '40px',
//           border: '4px solid #333',
//           borderTop: '4px solid #fff',
//           borderRadius: '50%',
//           animation: 'spin 1s linear infinite',
//         }}
//       />

//       <style>{`
//         @keyframes spin {
//           0% { transform: rotate(0deg); }
//           100% { transform: rotate(360deg); }
//         }
//       `}</style>

//       <div style={{fontSize: '16px', textAlign: 'center'}}>
//         {getMessage()}
//       </div>

//       <button
//         onClick={handleTestToggle}
//         style={{
//           position: 'absolute',
//           bottom: '1rem',
//           padding: '0.5rem 1rem',
//           backgroundColor: testMode ? '#4a9eff' : '#333',
//           color: '#fff',
//           border: 'none',
//           borderRadius: '4px',
//           cursor: 'pointer',
//           fontSize: '0.75rem',
//           fontFamily: 'monospace',
//         }}
//       >
//         {testMode
//           ? `Test: ${displayState.t} (click to cycle)`
//           : 'Click to test states'}
//       </button>
//     </div>
//   )
// }

// // Wait for DOM to be ready
// const root = document.getElementById('root')
// if (root) {
//   ReactDOM.createRoot(root).render(
//     <React.StrictMode>
//       <LoadingWindow />
//     </React.StrictMode>,
//   )
// }

console.log('HELLO WORLD')
