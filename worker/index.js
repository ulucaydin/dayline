import assets from 'dayline:assets';
import { handleDictation } from './dictation.js';
import { handleIntake } from './intake.js';
import { handleCaptureKeys } from './provider-keys.js';
import { handleTaskSync } from './task-sync.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/task-sync') return handleTaskSync(request, env);
    if (pathname === '/api/dictation') return handleDictation(request, env);
    if (pathname === '/api/intake') return handleIntake(request, env);
    if (pathname === '/api/capture-keys') return handleCaptureKeys(request, env);
    const path = pathname === '/' ? '/index.html' : pathname;
    const asset = Object.hasOwn(assets, path) ? assets[path] : null;
    if (!asset || !['GET', 'HEAD'].includes(request.method)) {
      return new Response('Page not found.', { status: 404 });
    }

    return new Response(request.method === 'HEAD' ? null : Uint8Array.from(atob(asset.data), (byte) => byte.charCodeAt(0)), {
      headers: {
        'Content-Type': asset.type,
        'Cache-Control': asset.fingerprinted ? 'private, max-age=31536000, immutable' : 'private, no-cache',
        ...(path === '/download/Dayline.apk' ? { 'Content-Disposition': 'attachment; filename="Dayline.apk"' } : {}),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
};
