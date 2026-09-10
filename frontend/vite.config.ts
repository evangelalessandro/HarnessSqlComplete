import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Ignora i file temporanei creati accanto ai sorgenti (es. ".SqlEditor.tsx.<pid>.tmpdir/x.tmp"):
    // il watcher ci sbatteva contro con EBUSY e il dev server MORIVA, lasciando l'app
    // con moduli vecchi/mezzi aggiornati (sintomo: "l'intellisense si è rotta").
    watch: {
      ignored: ['**/.*.tmpdir/**', '**/*.tmp', '**/.*.tmp', '**/.~*'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:5213',
        changeOrigin: true,
      },
    },
  },
})
