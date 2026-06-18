import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');

const bundles = [
  { in: 'src/background/service-worker.ts', out: 'background/service-worker.js' },
  { in: 'src/content/index.ts', out: 'content/content.js' },
  { in: 'src/popup/popup.ts', out: 'popup/popup.js' },
];

function copyStaticAssets() {
  mkdirSync(join(dist, 'popup'), { recursive: true });
  mkdirSync(join(dist, 'styles'), { recursive: true });
  mkdirSync(join(dist, 'background'), { recursive: true });
  mkdirSync(join(dist, 'content'), { recursive: true });

  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));

  cpSync(join(root, 'src/popup/popup.html'), join(dist, 'popup/popup.html'));
  cpSync(join(root, 'styles/overlay.css'), join(dist, 'styles/overlay.css'));
  cpSync(join(root, 'icons'), join(dist, 'icons'), { recursive: true });
}

async function build() {
  rmSync(dist, { recursive: true, force: true });
  copyStaticAssets();

  const ctx = await esbuild.context({
    entryPoints: bundles.map((b) => ({
      in: join(root, b.in),
      out: b.out.replace(/\.js$/, ''),
    })),
    bundle: true,
    format: 'esm',
    outdir: dist,
    sourcemap: true,
    target: 'chrome120',
    logLevel: 'info',
  });

  if (watch) {
    await ctx.watch();
    console.log('Watching for changes…');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log('Build complete → dist/');
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
