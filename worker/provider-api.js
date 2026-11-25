const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export const models = {
  openai: { transcriber: 'gpt-transcribe', parser: 'gpt-6-luna', audioParser: 'gpt-audio-1.5' },
  gemini: { transcriber: 'gemini-3.5-transcribe', parser: 'gemini-4-hydrogen' },
};

export function json(data, status = 200) {
  return Response.json(data, { status, headers });
}

export function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function readBody(request, limit) {
  if (Number(request.headers.get('Content-Length')) > limit || !request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function readJson(request, limit) {
  try {
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return null;
    const bytes = await readBody(request, limit);
    return bytes && JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

export function base64(bytes) {
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 8_192) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8_192)));
  }
  return btoa(chunks.join(''));
}

export async function providerRequest(url, headers, body, signal, timeout = 10_000) {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
    redirect: 'manual',
  });
  if (!response.ok) throw new Error('Capture provider failed.');
  return response.json();
}

export async function geminiText(body, key, signal, timeout) {
  const result = await providerRequest(
    'https://generativelanguage.googleapis.com/v1beta/interactions',
    { 'x-goog-api-key': key, 'Api-Revision': '2026-05-20', 'Content-Type': 'application/json' },
    JSON.stringify({ ...body, store: false }), signal, timeout,
  );
  if (result.status !== 'completed') throw new Error('Gemini did not complete the request.');
  return result.steps?.filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('');
}
