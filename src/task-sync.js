import { syncRequest } from './task-sync-state.js';

export const syncMessages = {
  local: 'Tasks are saved on this device.',
  connecting: 'Checking for synced tasks…',
  synced: 'Tasks sync across devices signed in to this Dayline site.',
  offline: 'Offline. Changes will sync when you reconnect.',
  retry: 'Tasks are available here. Sync will retry automatically.',
  account: 'Open Dayline with the same account to sync these tasks.',
};

const pollDelay = 12_000;
const requestTimeout = 8_000;

export function startTaskSync({ read, apply, status }) {
  let timer;
  let due = Infinity;
  let running = false;
  let next = Infinity;
  let retryDelay = 2_000;

  function schedule(delay = 250) {
    if (running) {
      next = Math.min(next, delay);
      return;
    }
    if (Date.now() + delay >= due) return;
    clearTimeout(timer);
    due = Date.now() + delay;
    timer = setTimeout(run, delay);
  }

  async function run() {
    due = Infinity;
    if (!navigator.onLine) {
      status('offline');
      return;
    }
    const sync = read();
    if (document.hidden && !sync.pending.length) return;

    running = true;
    const request = syncRequest(sync);
    const body = JSON.stringify(request.body);
    let delay = pollDelay;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), requestTimeout);
    try {
      const response = await fetch(new URL('api/task-sync', document.baseURI), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: abort.signal,
        keepalive: new TextEncoder().encode(body).byteLength < 60_000,
        body,
      });
      if (response.status === 401 || response.status === 403 || response.status === 409 || response.redirected) {
        status('account');
        return;
      }
      if (response.status === 404 || response.status === 405) {
        status('local');
        delay = 60_000;
        return;
      }
      if (!response.ok) throw new Error('Could not sync tasks');
      if (!response.headers.get('Content-Type')?.startsWith('application/json')) {
        status('local');
        delay = 60_000;
        return;
      }
      const result = await response.json();
      const owner = read().owner;
      if (owner && owner !== result.owner) {
        status('account');
        return;
      }
      apply(request.mutations, result);
      retryDelay = 2_000;
      const updated = read();
      const more = result.more || updated.pending.length > 0;
      status(more ? 'connecting' : 'synced');
      if (more && (result.more || sync.owner !== updated.owner || sync.pending[0]?.key !== updated.pending[0]?.key)) delay = 0;
    } catch {
      status(navigator.onLine ? 'retry' : 'offline');
      delay = retryDelay;
      retryDelay = Math.min(60_000, retryDelay * 2);
    } finally {
      clearTimeout(timeout);
      running = false;
      const wait = Math.min(delay, next);
      next = Infinity;
      if (navigator.onLine && (!document.hidden || read().pending.length)) schedule(wait);
    }
  }

  window.addEventListener('online', () => schedule(0));
  window.addEventListener('offline', () => status('offline'));
  window.addEventListener('focus', () => schedule(0));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) schedule(0);
    else if (!running && read().pending.length) {
      clearTimeout(timer);
      run();
    }
  });
  schedule(0);
  return schedule;
}
