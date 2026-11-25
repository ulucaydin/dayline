import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const client = fileURLToPath(new URL('dist/client/', root));
const mimeTypes = {
  '.apk': 'application/vnd.android.package-archive',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const entries = await readdir(client, { recursive: true, withFileTypes: true });
const assets = {};
for (const entry of entries.filter((item) => item.isFile())) {
  const filename = join(entry.parentPath, entry.name);
  const url = '/' + relative(client, filename).split(sep).join('/');
  assets[url] = {
    data: (await readFile(filename)).toString('base64'),
    type: mimeTypes[extname(entry.name)] ?? 'application/octet-stream',
    fingerprinted: url.startsWith('/assets/') && /\.(css|js|woff2)$/.test(url),
  };
}

await build({
  entryPoints: [fileURLToPath(new URL('worker/index.js', root))],
  outfile: fileURLToPath(new URL('dist/server/index.js', root)),
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  plugins: [{
    name: 'dayline-assets',
    setup(builder) {
      builder.onResolve({ filter: /^dayline:assets$/ }, () => ({ path: 'assets', namespace: 'dayline' }));
      builder.onLoad({ filter: /.*/, namespace: 'dayline' }, () => ({ contents: `export default ${JSON.stringify(assets)}` }));
    },
  }],
});
