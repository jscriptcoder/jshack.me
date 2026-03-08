import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { initializeStorage } from './utils/storageCache';

const startApp = async (): Promise<void> => {
  await initializeStorage();

  createRoot(document.getElementById('root')!).render(<App />);
};

startApp();
