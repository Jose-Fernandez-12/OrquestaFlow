import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { store } from './store'
import App from './App.tsx'
import './index.css'
import { getSavedTheme, applyThemeColor } from './lib/theme'
import { installApiAccess } from './lib/api'

// Before anything calls the API: requests must carry the access cookie (other computers)
installApiAccess();

// Inicializar color de acento guardado
applyThemeColor(getSavedTheme());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>,
)
