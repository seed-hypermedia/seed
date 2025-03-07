import {StyleProvider} from '@/app-context-provider'
import '@tamagui/core/reset.css'
import '@tamagui/font-inter/css/400.css'
import '@tamagui/font-inter/css/700.css'
import React, {useEffect, useState} from 'react'
import ReactDOM from 'react-dom/client'
import {FindInPage} from './pages/find-in-page'

function FindInPageView() {
  const [darkMode, setDarkMode] = useState(false)

  useEffect(() => {
    // @ts-expect-error
    const unsubscribe = window.darkMode?.subscribe((value: boolean) => {
      setDarkMode(value)
    })
    return () => unsubscribe?.()
  }, [])

  return (
    <div
      className={darkMode ? 'seed-app-dark' : 'seed-app-light'}
      style={{width: '100%', height: '100%'}}
    >
      <StyleProvider darkMode={darkMode}>
        <FindInPage />
      </StyleProvider>
    </div>
  )
}

// Wait for DOM to be ready
const root = document.getElementById('root')
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <FindInPageView />
    </React.StrictMode>,
  )
}
