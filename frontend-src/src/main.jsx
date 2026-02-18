import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { Store } from './lib/store';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Store>
      <App />
    </Store>
  </React.StrictMode>
);
