import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// No long-press context menus — keys must be holdable.
document.addEventListener('contextmenu', (event) => event.preventDefault());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
