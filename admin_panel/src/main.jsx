import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import Experience from '../../shared/Experience'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Experience role="Administration"><App /></Experience>
  </StrictMode>,
)
