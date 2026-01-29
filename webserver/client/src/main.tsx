import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@neutab/shared/bootstrap/restoreTheme'
import '@neutab/shared/bootstrap/preloadTheme'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
