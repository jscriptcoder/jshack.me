import { render } from 'solid-js/web';
import { App } from './ui/screens/App';
import { consumeFreshTabFlag } from './ui/freshTab';
import { adoptStoredTheme } from './ui/state';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

// The player's colour goes on the document BEFORE the first render. Inside the
// app it would be an effect, which runs after the first paint by definition —
// and the whole terminal would flash amber on the way to whatever they chose.
adoptStoredTheme();

// Read AND spent here, before anything starts a game: the flag decides how this
// terminal boots, and leaving it in the address bar would make every later reload
// of this tab boot the same way.
const freshTab = consumeFreshTabFlag(window.location, window.history);

render(() => <App storage={localStorage} fresh={freshTab} />, root);
