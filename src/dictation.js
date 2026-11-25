import { encodeWave, recordVoice } from './voice-audio.js';
import { longRecordingTimeout, shortWaveBytes } from './voice-providers.js';
import { maxVoiceText, shortVoiceText } from './voice-tasks.js';
import { interpretVoice } from './capture-api.js';

const noSpeech = 'I didn’t hear a request. Tap the mic to try again.';
const speechEndpoint = () => new URL('api/dictation', document.baseURI);
let localWorker;

export function tidyDictation(value) {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/gu, ' ').replace(/[.!?。！？]+$/u, '').trim()
    : '';
}

async function availableNativeRecognition({ signal, progress }) {
  const Recognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
  if (!Recognition || !('processLocally' in Recognition.prototype)) return null;

  const language = navigator.language || 'en-US';
  const options = { langs: [language], processLocally: true, quality: 'dictation' };
  try {
    if (typeof Recognition.available === 'function') {
      const status = await Recognition.available(options);
      if (status !== 'available') {
        if (!navigator.onLine || !['downloadable', 'downloading'].includes(status) || !Recognition.install) return null;
        signal.throwIfAborted();
        progress('starting', 'Preparing device speech…');
        if (!await Recognition.install(options)) return null;
      }
    }
    const recognition = new Recognition();
    recognition.lang = language;
    recognition.processLocally = true;
    recognition.continuous = true;
    recognition.interimResults = true;
    return recognition;
  } catch {
    signal.throwIfAborted();
    return null;
  }
}

function listenOnDevice(recognition, { signal, setStop, progress, recordingSeconds }) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let text = '';
    let limitTimer;
    let restartTimer;
    let finishTimer;
    let running = false;
    let finishing = false;
    const settle = () => {
      clearTimeout(limitTimer);
      clearTimeout(restartTimer);
      clearTimeout(finishTimer);
      recognition.onend = recognition.onerror = recognition.onresult = null;
      signal.removeEventListener('abort', cancel);
      setStop(null);
    };
    const complete = () => {
      settle();
      resolve([...parts, text].join(' '));
    };
    const cancel = () => {
      settle();
      reject(signal.reason);
      if (running) recognition.abort();
    };
    const stop = () => {
      finishing = true;
      clearTimeout(limitTimer);
      setStop(null);
      if (!running) return complete();
      try {
        finishTimer = setTimeout(() => {
          complete();
          recognition.abort();
        }, 3_000);
        recognition.stop();
      } catch {
        complete();
      }
    };
    recognition.onresult = ({ results }) => {
      text = Array.from(results, (result) => result[0]?.transcript ?? '').join(' ');
    };
    recognition.onerror = ({ error }) => {
      if (error === 'no-speech') return;
      settle();
      if (!finishing && !parts.length && !text && ['language-not-supported', 'language-unavailable', 'service-not-allowed'].includes(error)) {
        resolve(null);
        return;
      }
      const message = error === 'not-allowed' ? 'Allow microphone access, then tap the mic again.' : 'Device dictation couldn’t start. Try again.';
      reject(new Error(message));
    };
    recognition.onend = () => {
      running = false;
      if (finishing) return complete();
      if (text.trim()) parts.push(text.trim());
      text = '';
      restartTimer = setTimeout(() => {
        try {
          recognition.start();
          running = true;
        } catch {
          settle();
          reject(new Error('Device dictation stopped. Tap the mic to try again.'));
        }
      }, 150);
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      recognition.start();
      running = true;
      setStop(stop);
      limitTimer = setTimeout(() => {
        progress('working', 'Time limit reached. Finishing recording…');
        stop();
      }, recordingSeconds * 1000);
      progress('listening', 'Listening. Tap when you’re done.');
    } catch {
      settle();
      resolve(null);
    }
  });
}

function runLocalModel(samples, { signal, progress }) {
  signal.throwIfAborted();
  if (!samples.length) return Promise.resolve('');
  if (!localWorker) {
    localWorker = new Worker(new URL('voice/model.js', document.baseURI), { type: 'module' });
  }
  const worker = localWorker;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener('abort', cancel);
      worker.onmessage = null;
      worker.onerror = null;
    };
    const fail = (error) => {
      cleanup();
      worker.terminate();
      localWorker = null;
      reject(error);
    };
    const cancel = () => fail(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    worker.onerror = () => fail(new Error('Connect to the internet once to prepare on-device speech.'));
    worker.onmessage = ({ data }) => {
      if (data.phase === 'loading') progress('working', navigator.onLine
        ? 'Preparing on-device speech. The first use needs a download.' : 'Loading on-device speech…');
      else if (data.phase === 'transcribing') progress('working', 'Transcribing on this device…');
      else if (data.error) fail(new Error(data.error));
      else {
        cleanup();
        resolve(data.text);
      }
    };
    progress('working', 'Transcribing on this device…');
    worker.postMessage(samples, [samples.buffer]);
  });
}

async function cloudVoice(provider, body, signal, timeout = 12_000) {
  const url = speechEndpoint();
  url.searchParams.set('provider', provider);
  const response = await fetch(url, {
    method: 'POST',
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
    body,
  });
  if (!response.ok) throw new Error('Cloud dictation is unavailable.');
  const result = await response.json();
  const text = tidyDictation(result.text);
  if (!text) throw new Error(noSpeech);
  return { text: text.slice(0, maxVoiceText), actions: result.actions };
}

async function deviceVoice(options) {
  const native = await availableNativeRecognition(options);
  options.signal.throwIfAborted();
  if (native) {
    const result = await listenOnDevice(native, options);
    if (result !== null) return result;
  }
  const samples = await recordVoice(options);
  return runLocalModel(samples, options);
}

async function dictate({ provider, intakeProvider, date, selected, signal, progress, ...options }) {
  const transcriber = navigator.onLine ? provider : 'device';
  if (transcriber === 'openai' || transcriber === 'gemini') {
    const samples = await recordVoice({ signal, progress, ...options });
    if (!samples.length) throw new Error(noSpeech);
    let body = encodeWave(samples);
    const timeout = body.size > shortWaveBytes ? longRecordingTimeout + 5_000 : undefined;
    const combined = transcriber === intakeProvider;
    if (combined) {
      const recording = new FormData();
      recording.set('audio', body, 'task.wav');
      recording.set('date', date);
      recording.set('mode', 'voice');
      recording.set('selected', String(selected));
      body = recording;
    }
    progress('working', combined ? 'Listening finished. Understanding your request…' : 'Transcribing…');
    try {
      return { ...await cloudVoice(transcriber, body, signal, timeout), combined };
    } catch {
      signal.throwIfAborted();
      const text = tidyDictation(await runLocalModel(samples, { signal, progress }));
      if (!text) throw new Error(noSpeech);
      return { text, combined };
    }
  }

  const text = tidyDictation(await deviceVoice({ signal, progress, ...options })).slice(0, maxVoiceText);
  if (!text) throw new Error(noSpeech);
  signal.throwIfAborted();
  if (transcriber === 'opus') {
    progress('working', 'Checking the transcript…');
    try {
      return await cloudVoice('opus', text, signal, text.length > shortVoiceText ? longRecordingTimeout + 5_000 : undefined);
    } catch {
      signal.throwIfAborted();
    }
  }
  return { text };
}

export function createVoiceControls(captureOptions, finish) {
  let active;
  let notice;

  function paint() {
    document.querySelectorAll('button[data-voice-control]').forEach((button) => {
      const surface = button.dataset.voiceControl;
      const phase = active?.surface === surface ? notice?.phase : null;
      const idle = button.dataset.voiceLabel;
      const label = phase === 'listening' ? 'Finish recording' : phase ? 'Cancel' : idle;
      const caption = button.querySelector('.voice-label');
      const action = phase && phase !== 'listening' ? 'Cancel voice request' : label;
      button.setAttribute('aria-label', phase && !caption ? `${idle}. ${action}` : action);
      if (phase) button.dataset.voicePhase = phase;
      else delete button.dataset.voicePhase;
      if (caption && caption.textContent !== label) caption.textContent = label;
    });
    document.querySelectorAll('[data-voice-status]').forEach((status) => {
      const message = notice?.surface === status.dataset.voiceStatus ? notice.text : '';
      if (status.textContent !== message) status.textContent = message;
    });
  }

  function cancel(surface) {
    const stopped = active && (!surface || active.surface === surface) ? active : null;
    if (stopped) {
      active = null;
      stopped.abort.abort();
    }
    if (!surface || notice?.surface === surface) notice = null;
    paint();
    return Boolean(stopped);
  }

  async function toggle(surface, context) {
    if (active?.surface === surface && active.stop) {
      const { stop } = active;
      active.stop = null;
      notice = { surface, phase: 'working', text: 'Finishing recording…' };
      paint();
      stop();
      return;
    }
    const togglingOff = active?.surface === surface;
    cancel();
    if (togglingOff) return;

    const abort = new AbortController();
    const request = { surface, abort, stop: null };
    const options = captureOptions();
    const selected = Boolean(context.taskId);
    active = request;
    const progress = (phase, text) => {
      if (active !== request) return;
      notice = { surface, phase, text };
      paint();
    };

    progress('starting', 'Getting the microphone ready…');
    try {
      const result = await dictate({
        ...options, selected, signal: abort.signal, progress,
        setStop: (stop) => { request.stop = stop; },
      });
      abort.signal.throwIfAborted();
      let { actions } = result;
      if (!result.combined && options.intakeProvider !== 'device' && navigator.onLine) {
        progress('working', 'Understanding your request…');
        actions = await interpretVoice(options.intakeProvider, result.text, options.date, selected, abort.signal);
      }
      if (active !== request) return;
      const text = finish(result.text, actions, { ...context, date: options.date });
      notice = { surface, text: text || '' };
    } catch (error) {
      if (active === request) {
        const message = error instanceof DOMException
          ? ['NotAllowedError', 'SecurityError'].includes(error.name)
            ? 'Allow microphone access, then tap the mic again.'
            : 'Couldn’t use the microphone. Try again.'
          : error.message;
        notice = { surface, text: message || 'Dictation couldn’t start. Try again.' };
      }
    } finally {
      if (active === request) active = null;
      paint();
    }
  }

  return { toggle, cancel, paint };
}
