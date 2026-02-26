import { build, context } from 'esbuild';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const entry = path.join(root, 'src', 'browser.ts');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

const mode = process.argv[2] || 'dev';
const watch = mode === 'watch';
const minify = mode === 'min';
const outfile = minify
  ? path.join(distDir, 'snap.bundle.min.js')
  : path.join(distDir, 'snap.bundle.js');

await mkdir(distDir, { recursive: true });

const shared = {
  entryPoints: [entry],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'SNAP',
  sourcemap: true,
  target: ['es2020'],
  define: {
    __SNAP_VERSION__: JSON.stringify(pkg.version),
  },
  logLevel: 'info',
};

if (watch) {
  const ctx = await context({
    ...shared,
    outfile: path.join(distDir, 'snap.bundle.js'),
    minify: false,
  });
  await ctx.watch();
  console.log('Watching dist/snap.bundle.js');
} else {
  await build({
    ...shared,
    outfile,
    minify,
  });
}
