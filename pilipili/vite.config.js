import { defineConfig } from 'vite';

// Relative base so the build drops into any static host / itch.io zip.
// rapier2d-compat inlines its WASM (base64), so no special asset handling is
// needed; three/addons resolve through three's package "exports" map.
export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500, // three + rapier + postprocessing are chunky
  },
  optimizeDeps: {
    // Pre-bundle the WASM-carrying package so cold dev-start is smooth.
    include: ['@dimforge/rapier2d-compat', 'three', 'postprocessing'],
  },
});
