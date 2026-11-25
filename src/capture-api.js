function endpoint(path) {
  return new URL(`api/${path}`, document.baseURI);
}

function post(path, body, signal) {
  return fetch(endpoint(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    signal,
    body: JSON.stringify(body),
  });
}

export async function getCaptureAvailability() {
  try {
    const response = await fetch(endpoint('dictation'), { cache: 'no-store', signal: AbortSignal.timeout(4_000) });
    if (response.ok) return await response.json();
  } catch {
    // On-device capture is available while the site is offline.
  }
  return null;
}

export async function updateCaptureKey(provider, key) {
  const response = await post('capture-keys', { provider, key }, AbortSignal.timeout(6_000));
  if (!response.ok) throw new Error('Key update failed.');
  return response.json();
}

export async function interpretVoice(provider, text, date, selected, signal) {
  try {
    const response = await post('intake', { provider, text, date, selected, mode: 'voice' }, AbortSignal.any([signal, AbortSignal.timeout(4_200)]));
    if (response.ok) return (await response.json()).actions;
  } catch {
    // The app can finish with its on-device parse.
  }
  return null;
}
