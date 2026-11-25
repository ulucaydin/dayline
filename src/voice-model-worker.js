import { AutomaticSpeechRecognitionPipeline, env, WhisperForConditionalGeneration, WhisperProcessor } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.useWasmCache = true;
env.backends.onnx.wasm.numThreads = 1;
const revision = 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7';
env.remotePathTemplate = `{model}/resolve/${revision}/`;

let model;

async function loadModel() {
  // The runtime and the model use immutable URLs. Cache them even when their host varies by Origin.
  const cache = await self.caches?.open('dayline-voice-model-v1').catch(() => null);
  if (cache) {
    env.useCustomCache = true;
    env.customCache = {
      match: (url) => cache.match(url, { ignoreVary: true }),
      put: (url, response) => cache.put(url, response),
    };
  }
  const id = 'onnx-community/whisper-tiny';
  const offline = self.navigator.onLine === false;
  env.allowLocalModels = offline;
  const options = { revision, device: 'wasm', dtype: 'q8', local_files_only: offline };
  const [speechModel, processor] = await Promise.all([
    WhisperForConditionalGeneration.from_pretrained(id, options),
    WhisperProcessor.from_pretrained(id, options),
  ]);
  return new AutomaticSpeechRecognitionPipeline({
    task: 'automatic-speech-recognition', model: speechModel, processor, tokenizer: processor.tokenizer,
  });
}

self.addEventListener('message', async ({ data: samples }) => {
  try {
    if (!model) {
      self.postMessage({ phase: 'loading' });
      model = await loadModel();
    }
    self.postMessage({ phase: 'transcribing' });
    const result = await model(samples, { return_timestamps: false, max_new_tokens: 120 });
    self.postMessage({ text: result.text });
  } catch {
    const error = self.navigator.onLine
      ? 'On-device speech is unavailable. Try your keyboard’s dictation.'
      : 'Connect once to prepare on-device speech, or use keyboard dictation.';
    self.postMessage({ error });
  }
});
