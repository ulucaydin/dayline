import { sampleRate, waveHeaderBytes } from './voice-providers.js';

export function releaseMicrophone(stream) {
  stream.getTracks().forEach((track) => track.stop());
}

export async function recordVoice({ signal, setStop, progress, recordingSeconds }) {
  if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder || !globalThis.OfflineAudioContext) {
    throw new Error('To use the microphone, open Dayline in a browser with voice access.');
  }
  progress('starting', 'Opening microphone…');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  try {
    signal.throwIfAborted();
    const recording = await new Promise((resolve, reject) => {
      const recorder = new MediaRecorder(stream, { audioBitsPerSecond: 48_000 });
      const chunks = [];
      let timeout;
      let finishing = false;

      const stop = () => {
        finishing = true;
        clearTimeout(timeout);
        setStop(null);
        if (recorder.state !== 'inactive') recorder.stop();
        releaseMicrophone(stream);
      };
      const cleanup = () => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', cancel);
        setStop(null);
      };
      const cancel = () => {
        stop();
        cleanup();
        reject(signal.reason);
      };
      recorder.ondataavailable = ({ data }) => {
        if (data.size) chunks.push(data);
      };
      recorder.onstop = () => {
        cleanup();
        if (finishing) resolve(new Blob(chunks, { type: recorder.mimeType }));
        else reject(new Error('The microphone disconnected. Tap to start again.'));
      };
      recorder.onerror = (event) => {
        stop();
        cleanup();
        reject(event.error);
      };

      signal.addEventListener('abort', cancel, { once: true });
      try {
        recorder.start();
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }
      setStop(stop);
      timeout = setTimeout(() => {
        progress('working', 'Time limit reached. Finishing recording…');
        stop();
      }, recordingSeconds * 1000);
      progress('listening', 'Listening. Tap when you’re done.');
    });

    signal.throwIfAborted();
    if (!recording.size) return new Float32Array();
    const decoder = new OfflineAudioContext(1, 1, sampleRate);
    const decoded = await decoder.decodeAudioData(await recording.arrayBuffer());
    const length = Math.min(decoded.length, sampleRate * recordingSeconds);
    const mono = decoded.getChannelData(0).slice(0, length);
    if (decoded.numberOfChannels > 1) {
      for (let channel = 1; channel < decoded.numberOfChannels; channel += 1) {
        const data = decoded.getChannelData(channel);
        for (let i = 0; i < length; i += 1) mono[i] += data[i];
      }
      for (let i = 0; i < length; i += 1) mono[i] /= decoded.numberOfChannels;
    }
    return mono.some((sample) => Math.abs(sample) > 0.002) ? mono : new Float32Array();
  } finally {
    releaseMicrophone(stream);
  }
}

export function encodeWave(samples) {
  const bytes = new ArrayBuffer(waveHeaderBytes + samples.length * 2);
  const view = new DataView(bytes);
  const tag = (offset, text) => [...text].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)));
  tag(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  tag(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const amplitude = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(waveHeaderBytes + index * 2, amplitude < 0 ? amplitude * 32768 : amplitude * 32767, true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}
