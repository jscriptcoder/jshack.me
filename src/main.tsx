import { render } from 'solid-js/web';
import { App } from './ui/screens/App.js';
import { consumeFreshTabFlag } from './ui/freshTab.js';
import { adoptStoredTheme } from './ui/state.js';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

// The player's colour goes on the document BEFORE the first render. Inside the
// app it would be an effect, which runs after the first paint by definition —
// and the whole terminal would flash the default palette on the way to whatever
// they chose.
adoptStoredTheme();

// Read AND spent here, before anything starts a game: the flag decides how this
// terminal boots, and leaving it in the address bar would make every later reload
// of this tab boot the same way.
const freshTab = consumeFreshTabFlag(window.location, window.history);

render(() => <App storage={localStorage} fresh={freshTab} />, root);
