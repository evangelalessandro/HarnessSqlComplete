import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // I test dei componenti React stanno in file .tsx (renderizzati con react-dom/server)
    include: ['src/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.tsx'],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
  },
})
