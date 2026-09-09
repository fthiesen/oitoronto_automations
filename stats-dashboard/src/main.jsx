import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { lang } from './i18n'

document.documentElement.lang = lang === 'en' ? 'en' : 'pt-BR'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
