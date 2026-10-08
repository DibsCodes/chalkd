import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

// Long-press would otherwise open Chromium's context menu.
window.addEventListener('contextmenu', (e) => e.preventDefault());

mount(App, { target: document.body });
