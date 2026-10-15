import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Experience from '../../shared/Experience'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Experience role="Customer"><App /></Experience>
  </StrictMode>,
)
