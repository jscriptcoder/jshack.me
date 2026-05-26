import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { ReworkNoticeScreen } from './components/ReworkNoticeScreen';
import { initializeStorage } from './utils/storageCache';

const SHOW_REWORK_NOTICE = import.meta.env.VITE_SHOW_REWORK_NOTICE === 'true';

const startApp = async (): Promise<void> => {
  const root = createRoot(document.getElementById('root')!);

  if (SHOW_REWORK_NOTICE) {
    root.render(<ReworkNoticeScreen />);
    return;
  }

  await initializeStorage();

  if (import.meta.env.DEV) {
    const { installTestApi } = await import('./test/testApi');
    installTestApi();
  }

  root.render(<App />);
};

startApp();
