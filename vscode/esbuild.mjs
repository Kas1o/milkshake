import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

/** Both bundles are CJS: the vscode host and vscode-languageserver expect it,
 * and the engine's `typescript` import stays external (resolved at runtime). */
const targets = [
  {
    entryPoints: ['src/client.ts'],
    outfile: 'dist/client.js',
    external: ['vscode'],
  },
  {
    entryPoints: ['src/server/index.ts'],
    outfile: 'dist/server.js',
    external: ['typescript'],
  },
];

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: true,
  logLevel: 'info',
};

if (watch) {
  for (const t of targets) {
    const ctx = await context({ ...common, ...t });
    await ctx.watch();
  }
  console.log('watching...');
} else {
  for (const t of targets) {
    await build({ ...common, ...t });
  }
}
