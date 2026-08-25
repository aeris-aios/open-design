import { build } from 'esbuild';

await build({
  bundle: true,
  entryNames: '[dir]/[name]',
  entryPoints: ['./src/index.ts', './src/manual-edit.ts'],
  format: 'esm',
  outbase: './src',
  outdir: './dist',
  outExtension: { '.js': '.mjs' },
  packages: 'external',
  platform: 'neutral',
  target: 'es2022',
});
