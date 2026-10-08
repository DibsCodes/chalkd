import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [svelte()],
  build: {
    rolldownOptions: {
      input: {
        main: 'index.html',
        spike: 'spike.html',
      },
    },
  },
});
