import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// يُستورد قبل أي مكوّن: النصوص والاتجاه يجب أن يجهزا قبل أول رسم.
import '@/lib/i18n'
import App from './App.tsx'
import { ThemeProvider } from '@/lib/theme'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
