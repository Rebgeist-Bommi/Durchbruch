import { defineConfig } from 'vite';

// Relative Basis: läuft unter https://<nutzer>.github.io/<repo>/ ohne Anpassung.
export default defineConfig({
  base: './',
  build: { target: 'es2020', assetsInlineLimit: 0 },
});
