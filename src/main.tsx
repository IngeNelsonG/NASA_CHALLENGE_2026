import '@fontsource/fira-sans/latin-600.css';
import '@fontsource/fira-sans/latin-800.css';
import '@fontsource/overpass/latin-400.css';
import '@fontsource/overpass/latin-600.css';
import '@fontsource/overpass-mono/latin-400.css';
import './index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: 1 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
