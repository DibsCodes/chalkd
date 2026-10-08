import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        main: 'index.html',
        spike: 'spike.html',
      },
    },
  },
});
