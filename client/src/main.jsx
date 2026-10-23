import { createRoot } from 'react-dom/client';
import './engines.js';
import '../../public/css/styles.css';
import './shell.css';
import App from './App.jsx';
import { init } from './store.js';

createRoot(document.getElementById('root')).render(<App />);
init();
