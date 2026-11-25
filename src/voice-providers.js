export const voiceProviders = {
  device: { label: 'On this device', description: 'Speech stays on this device. Some browsers need a one-time model download.' },
  openai: { label: 'ChatGPT (OpenAI)', description: 'Sends your recording to OpenAI for transcription.' },
  opus: { label: 'Claude Opus', description: 'Uses device dictation and sends the draft text to Claude Opus for cleanup.' },
  gemini: { label: 'Google Gemini', description: 'Sends your recording to Gemini for transcription.' },
};

export const intakeProviders = {
  device: { label: 'On this device', description: 'Understands task requests on this device.' },
  openai: { label: voiceProviders.openai.label, description: 'Sends your spoken request to OpenAI to understand what to add or change.' },
  gemini: { label: voiceProviders.gemini.label, description: 'Sends your spoken request to Google to understand what to add or change.' },
};

export const maxCaptureLength = 220;
export const sampleRate = 16_000;
export const maxRecordingSeconds = 30;
export const waveHeaderBytes = 44;
export const maxWaveBytes = waveHeaderBytes + maxRecordingSeconds * sampleRate * 2;
