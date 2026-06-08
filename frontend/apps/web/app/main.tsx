import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {AppRouter} from './router'
import './styles.css'
import './tailwind.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Missing #root element')

createRoot(rootElement).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
)
