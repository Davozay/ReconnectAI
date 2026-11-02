import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import '../src/styles/globals.css';
import '../src/styles/components.css';
import App from '../src/App.tsx';
import { AuthProvider } from '../src/context/AuthContext.tsx';
import { ThemeProvider } from '../src/context/ThemeContext.tsx';
import { ToastProvider } from '../src/context/ToastContext.tsx';
import Toaster from '../src/components/Toaster.tsx';

const params = new URLSearchParams(window.location.search);
const entry = params.get('entry') || '/app/settings';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <MemoryRouter initialEntries={[entry]}>
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>
              <App />
              <Toaster />
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>
    </MotionConfig>
  </StrictMode>,
);
