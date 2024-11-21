// src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { Auth0ProviderWithConfig } from './components/Auth0ProviderWithConfig'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Auth0ProviderWithConfig>
      <App />
    </Auth0ProviderWithConfig>
  </React.StrictMode>
)