import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import './styles/globals.css';
import './styles/components.css';
import App from './App.tsx';
import { AuthProvider } from './context/AuthContext.tsx';
import { ThemeProvider } from './context/ThemeContext.tsx';
import { ToastProvider } from './context/ToastContext.tsx';
import Toaster from './components/Toaster.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>
              <App />
              <Toaster />
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </MotionConfig>
  </StrictMode>,
);
