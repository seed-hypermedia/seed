import {createRoot} from 'react-dom/client'
import {App} from './app'
import './styles.css'

const elem = document.getElementById('root')
if (!elem) throw new Error('root element not found')

const root = createRoot(elem)
root.render(<App />)
