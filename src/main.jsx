import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Player from './Player.jsx';
import './styles.css';

const player = window.location.pathname.match(/^\/player\/([0-9a-f-]{36})\/?$/i);
createRoot(document.getElementById('root')).render(
  player ? <Player screenId={player[1]} /> : <App />,
);
