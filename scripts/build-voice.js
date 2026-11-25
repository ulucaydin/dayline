import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const entry = fileURLToPath(new URL('../src/voice-model-worker.js', import.meta.url));

export function buildVoiceWorker(outfile) {
  return build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'inline',
    outfile,
    write: Boolean(outfile),
  });
}
