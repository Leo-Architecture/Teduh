// Builds the React app into dist/. No framework tooling beyond esbuild.
//   npm run build        one build
//   npm run dev          rebuild when a file changes (run `npm start` in the project folder in another terminal)
import { build, context } from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const watch = process.argv.includes('--watch');

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'assets'), { recursive: true });

const options = {
  entryPoints: [join(here, 'src/main.jsx')],
  bundle: true,
  minify: !watch,
  sourcemap: false,
  target: 'es2020',
  jsx: 'automatic',
  format: 'iife',
  loader: { '.js': 'jsx', '.jsx': 'jsx' },
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  outdir: join(dist, 'assets'),
  entryNames: 'app',
  logLevel: 'info'
};

if (existsSync(join(here, 'public'))) cpSync(join(here, 'public'), dist, { recursive: true });   // logo, icons, splash video
writeFileSync(join(dist, 'index.html'), readFileSync(join(here, 'index.html'), 'utf8'));
if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('Watching for changes. Reload the page after each rebuild.');
} else {
  await build(options);
}
