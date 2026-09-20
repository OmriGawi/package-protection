/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Without this, a CSS import resolves to an empty string in tests — which
    // makes index.css.test.ts, the contrast guard, silently read nothing.
    css: true,
    globals: true,
    setupFiles: './src/test/setup.ts',
    coverage: {
      provider: 'v8',
      // Everything that ships, so a component with no test at all shows up as a
      // zero rather than vanishing from the denominator.
      include: ['src/**'],
      exclude: [
        'src/**/*.test.*',
        'src/test/**',
        // Mount point: renders <App/> into the DOM and nothing else.
        'src/main.tsx',
      ],
      reporter: ['text', 'text-summary'],
    },
  },
})
