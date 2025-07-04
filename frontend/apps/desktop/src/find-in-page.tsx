import React, {useEffect, useState} from 'react'
import ReactDOM from 'react-dom/client'
import {FindInPage} from './pages/find-in-page'
import './tailwind.css'

function FindInPageView() {
  const [darkMode, setDarkMode] = useState(false)

  useEffect(() => {
    const unsubscribe = window.darkMode?.subscribe((value: boolean) => {
      setDarkMode(value)
    })
    return () => unsubscribe?.()
  }, [])

  return (
    <div
      className={darkMode ? 'dark' : 'light'}
      style={{width: '100%', height: '100%'}}
    >
      <FindInPage />
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
