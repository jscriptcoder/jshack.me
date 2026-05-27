import { render } from 'solid-js/web';
import { Terminal } from './ui/screens/terminal';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

render(() => <Terminal />, root);
