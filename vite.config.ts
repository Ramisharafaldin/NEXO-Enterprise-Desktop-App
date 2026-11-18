import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: false,
    host: true,
    watch: {
      ignored: [
        '**/backend/**',
        '**/*.duckdb*',
        '**/*.wal',
        '**/*.db*',
        '**/*.xlsx',
        '**/*.xls',
        '**/*.csv',
        '**/dist/**',
        '**/.git/**',
      ],
    },
  },
});
