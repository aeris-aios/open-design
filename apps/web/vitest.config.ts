import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@excalidraw/excalidraw': resolve(__dirname, 'tests/helpers/excalidraw-mock.tsx'),
      '@xyflow/react': resolve(__dirname, 'tests/helpers/xyflow-mock.tsx'),
      '@tsparticles/react': resolve(__dirname, 'tests/helpers/tsparticles-react-mock.tsx'),
      'motion/react': resolve(__dirname, 'tests/helpers/motion-mock.tsx'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    // Keep this above the shared Testing Library asyncUtilTimeout so failed
    // waits retain Testing Library's assertion/DOM diagnostics.
    testTimeout: 5_000,
    setupFiles: ['./tests/setup/jsdom-lexical.ts', './tests/setup/coalesced-get-reset.ts'],
  },
});
