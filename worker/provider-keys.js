import { base64, json, readJson, sameOrigin } from './provider-api.js';

const runtimeNames = { openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY', opus: 'ANTHROPIC_API_KEY' };
const ownKeyProviders = ['openai', 'gemini'];
const encode = new TextEncoder();
const decode = new TextDecoder();

function fromBase64(text) {
  return Uint8Array.from(atob(text), (byte) => byte.charCodeAt(0));
}

function keyStorageAvailable(env) {
  return Boolean(env.DB && /^[A-Za-z0-9+/]{43}=$/.test(env.DAYLINE_CAPTURE_KEYS_SECRET ?? ''));
}

async function encryptionKey(env) {
  return crypto.subtle.importKey('raw', fromBase64(env.DAYLINE_CAPTURE_KEYS_SECRET), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function keyParameters(iv, owner, provider) {
  return { name: 'AES-GCM', iv, additionalData: encode.encode(JSON.stringify([owner, provider])) };
}

export async function captureAvailability(env, owner) {
  const canSaveKeys = keyStorageAvailable(env);
  const rows = canSaveKeys ? (await env.DB.prepare('SELECT provider FROM dayline_capture_keys WHERE owner_id = ?').bind(owner).all()).results : [];
  const personalKeys = Object.fromEntries(ownKeyProviders.map((provider) => [provider, rows.some((row) => row.provider === provider)]));
  return {
    canSaveKeys,
    personalKeys,
    providers: Object.fromEntries(Object.entries(runtimeNames).map(([provider, name]) => [provider, Boolean(personalKeys[provider] || env[name]?.trim())])),
  };
}

export async function captureKey(env, owner, provider) {
  if (!Object.hasOwn(runtimeNames, provider)) return '';
  if (keyStorageAvailable(env) && ownKeyProviders.includes(provider)) {
    const row = await env.DB.prepare('SELECT encrypted_key, nonce FROM dayline_capture_keys WHERE owner_id = ? AND provider = ?').bind(owner, provider).first();
    if (row) {
      const params = keyParameters(fromBase64(row.nonce), owner, provider);
      const decrypted = await crypto.subtle.decrypt(params, await encryptionKey(env), fromBase64(row.encrypted_key));
      return decode.decode(decrypted);
    }
  }
  return env[runtimeNames[provider]]?.trim() ?? '';
}

export async function handleCaptureKeys(request, env) {
  const owner = request.headers.get('oai-authenticated-user-id');
  if (!owner) return json({ error: 'Sign-in required.' }, 401);
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!sameOrigin(request)) return json({ error: 'Use this Dayline origin.' }, 403);
  if (!keyStorageAvailable(env)) return json({ error: 'Key storage is unavailable.' }, 503);
  const body = await readJson(request, 2_048);
  const provider = body?.provider;
  const key = typeof body?.key === 'string' ? body.key.trim() : body?.key;
  if (!ownKeyProviders.includes(provider) || (key !== null && (typeof key !== 'string' || !/^[!-~]{16,512}$/.test(key)))) {
    return json({ error: 'Enter a valid provider API key.' }, 400);
  }

  try {
    if (key === null) {
      await env.DB.prepare('DELETE FROM dayline_capture_keys WHERE owner_id = ? AND provider = ?').bind(owner, provider).run();
    } else {
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(keyParameters(nonce, owner, provider), await encryptionKey(env), encode.encode(key));
      await env.DB.prepare(`
        INSERT INTO dayline_capture_keys (owner_id, provider, encrypted_key, nonce) VALUES (?, ?, ?, ?)
        ON CONFLICT (owner_id, provider) DO UPDATE SET encrypted_key = excluded.encrypted_key, nonce = excluded.nonce
      `).bind(owner, provider, base64(new Uint8Array(ciphertext)), base64(nonce)).run();
    }
    return json(await captureAvailability(env, owner));
  } catch {
    return json({ error: 'Key storage is temporarily unavailable.' }, 503);
  }
}
