import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './context/AuthContext';
import { SpaceProvider } from './context/SpaceContext';
import { pushService } from './services/pushNotification';
import './index.css';

// Initialize PWA Service Worker
if ('serviceWorker' in navigator) {
  if (document.readyState === 'complete') {
    pushService.registerServiceWorker();
  } else {
    window.addEventListener('load', () => {
      pushService.registerServiceWorker();
    });
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <SpaceProvider>
        <App />
      </SpaceProvider>
    </AuthProvider>
  </React.StrictMode>
);
