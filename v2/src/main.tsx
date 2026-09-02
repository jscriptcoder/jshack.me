import { render } from 'solid-js/web';
import { App } from './ui/screens/App';
import { adoptStoredTheme } from './ui/state';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

// The player's colour goes on the document BEFORE the first render. Inside the
// app it would be an effect, which runs after the first paint by definition —
// and the whole terminal would flash amber on the way to whatever they chose.
adoptStoredTheme();

render(() => <App storage={localStorage} />, root);
