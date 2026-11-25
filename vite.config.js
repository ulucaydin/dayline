import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { buildVoiceWorker } from './scripts/build-voice.js';

const dist = new URL('./dist/client/', import.meta.url);
const worker = new URL('./src/service-worker.js', import.meta.url);
const voiceModel = 'voice/model.js';

export default defineConfig({
  base: './',
  build: { outDir: 'dist/client' },
  plugins: [{
    name: 'dayline-device-voice-preview',
    apply: 'serve',
    configureServer(server) {
      let voiceBundle;
      server.middlewares.use('/voice/model.js', async (_request, response, next) => {
        try {
          voiceBundle ??= buildVoiceWorker();
          const result = await voiceBundle;
          response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          response.end(result.outputFiles[0].contents);
        } catch (error) {
          voiceBundle = null;
          next(error);
        }
      });
    },
  }, {
    name: 'dayline-offline-assets',
    apply: 'build',
    async closeBundle() {
      await buildVoiceWorker(fileURLToPath(new URL(voiceModel, dist)));
      const files = (await readdir(dist, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name !== 'sw.js' && !entry.name.endsWith('.apk'))
        .map((entry) => relative(fileURLToPath(dist), join(entry.parentPath, entry.name)).split(sep).join('/'))
        .sort();
      const source = await readFile(worker, 'utf8');
      const hash = createHash('sha256').update(source);
      for (const file of files) hash.update(await readFile(new URL(file, dist)));
      const prepared = source
        .replace('__BUILD_VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__PRECACHE_FILES__', JSON.stringify(['./', ...files.filter((file) => file !== voiceModel).map((file) => `./${file}`)]));
      await writeFile(new URL('sw.js', dist), prepared);
    },
  }],
});
