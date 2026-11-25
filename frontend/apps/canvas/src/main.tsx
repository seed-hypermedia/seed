import ReactDOM from 'react-dom/client'
import {ReactFlowProvider} from '@xyflow/react'
import App from './App'
import '@xyflow/react/dist/style.css'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ReactFlowProvider>
    <App />
  </ReactFlowProvider>,
)
