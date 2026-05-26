import { render } from 'solid-js/web';
import { Hello } from './ui/screens/hello';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

render(() => <Hello />, root);
