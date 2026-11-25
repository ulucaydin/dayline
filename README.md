# Dayline

Dayline is an installable, offline-capable task planner for choosing one next step across work and personal life.

## Start here

- Tap **Talk to Dayline**, choose **Speak** from navigation, or press **N**. Say “Call the dentist tomorrow and send the recap by Friday for work.” Dayline saves the tasks when you finish speaking. Tap **Finish recording** to stop immediately.
- Use a task’s mic to say a change like “Move it to Friday and make it high priority” or “Add a note to bring the referral.” You can also name a task from the main mic. Tap a task to see its details, and use **Undo** after saving to reverse the latest voice action.
- Use the mic in Today for tasks you plan to work on today, and in Inbox to save something for later. **Next** with a weekday means the following calendar week, starting Monday.
- Use **Today** to see what’s planned and due across both spaces. **Smart sort** weighs deadlines, priority, and estimated effort. **Light tasks** gives short tasks an extra boost.
- The suggested task shows its first unchecked step. Choose **Start focus** to open the task and a timer, and check off steps as you go.

## On-device speech

**On this device** uses your browser’s local speech model when available. Other browsers download a local Whisper model on first use and can dictate offline after that. [On-device speech recognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally) · [Whisper model](https://huggingface.co/onnx-community/whisper-tiny)

## Optional cloud capture

In **Settings → Task capture → API keys**, save an OpenAI or Gemini API key. Choose a **Transcriber**, **Task interpretation**, or both. Keys are encrypted on the server and available when you sign in to the same Dayline account on another device.

- Matching OpenAI or Gemini selections use one request per recording. GPT-Audio-1.5 or Gemini 4 Hydrogen receives the audio, the local date, and whether you opened the mic for a particular task. It returns a transcript and the requested additions or changes. [GPT-Audio-1.5](https://developers.openai.com/api/docs/models/gpt-audio-1.5) · [Gemini 4 Hydrogen](https://aistudio.google.com/docs/models/gemini-4-hydrogen)
- For standalone transcription, **Transcriber** sends the recording to GPT-Transcribe or Gemini 3.5 Transcribe. A site with a Claude Opus key can use on-device speech and send the transcript to Opus for cleanup. [OpenAI file transcription](https://developers.openai.com/api/docs/guides/speech-to-text) · [Gemini transcription](https://aistudio.google.com/docs/transcribe)
- When the provider selections differ, **Task interpretation** sends the finished transcript and date context to GPT-6 Luna or Gemini 4 Hydrogen. Dayline matches spoken task names against your list on the device. On-device interpretation takes over if the cloud provider times out. [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) · [Gemini 4 Hydrogen](https://aistudio.google.com/docs/models/gemini-4-hydrogen)

Cloud usage follows your provider’s API billing. Eligible ChatGPT plans may grant credits to a linked API organization. Direct ChatGPT plan access requires approval for hosted apps. Gemini uses an AI Studio project key. [ChatGPT plan access](https://developers.openai.com/siwc/quickstart) · [OpenAI API credits](https://help.openai.com/en/articles/20001626-api-credits-benefit-for-eligible-chatgpt-subscriptions) · [Gemini API billing](https://aistudio.google.com/docs/billing)

## Install and sync across devices

Open Dayline on the device you want to use and choose **Install app**. In Chrome or Edge, you can also use the browser’s install menu. Safari on macOS Sonoma or later offers **File → Add to Dock**. On Android, Chrome offers **Add to home screen → Install**. [Chrome installation guide](https://support.google.com/chrome/answer/9658361) · [Edge installation guide](https://support.microsoft.com/en-US/edge/install-manage-or-uninstall-apps-in-microsoft-edge) · [Safari installation guide](https://support.apple.com/en-us/104996)

Sign in to the published Dayline site with the same account on each device. Dayline syncs tasks automatically, including earlier tasks on a device when you next open it online. The app can reopen offline after its first successful load. Offline changes sync when you reconnect. **Settings → Export tasks** keeps a portable backup.

## Android APK

The Dayline APK adds a launcher icon and opens the existing workspace in an Android browser Custom Tab. Use the same ChatGPT account to sync tasks. Open the downloaded file on your phone to install it. [Pixel installation instructions](https://support.google.com/pixelphone/answer/7391672)

Set the launch URL in the Android activity to your hosted Dayline site before building. Build the installer with `bash scripts/build-android.sh` using Android SDK Platform 36, Build Tools 36.0.0, a JDK, and a release keystore with alias `dayline`. Set `ANDROID_HOME`, `DAYLINE_ANDROID_KEYSTORE`, and `DAYLINE_ANDROID_KEY_PASSWORD_FILE` before running the script. It verifies the signature and writes the downloadable APK used by the site. Keep the keystore and password outside the checkout, and reuse the same signing key for updates.

## Run locally

Use Node.js 22.12 or later.

```sh
npm ci
npm run dev
```

Use the production build to check offline behavior and installability.

```sh
npm run build
npm run preview
```

The Vite preview uses device-local storage. Serve `dist/client/` over HTTPS for installation and offline use, or use loopback on the same computer. The published Worker uses Sites identity and D1. Apply the database migrations in `drizzle/` and configure the encryption secret in `.env.example` to enable account API keys. Sites runtime secrets can also supply provider keys for an entire deployment.

## Artwork and fonts

The focus illustration lives at `public/assets/focus-tiles.webp`. It was generated with the built-in ImageGen tool and compressed as WebP with its transparency preserved.

> Use case: stylized-concept. Create a transparent illustration for the focus recommendation in a calm productivity app. Subject: a little stack of three loosely offset, rounded mint and jade ceramic tiles, seen at a gentle three-quarter angle, with one clearly embossed cream checkmark on the top tile and two small four-point sparks nearby. Style: premium soft 3D product illustration, matte material, diffuse daylight, subtle highlights and softly grounded shadow, using warm mint, deep jade and pale butter. Composition: compact, centered silhouette with generous transparent space around it, entire object in frame, readable at 180 pixels. True transparent background. No text, numbers, border, extra objects, or backdrop.

DM Sans and the Phosphor Regular icon subset are served locally. Their licenses are in `public/licenses/`.
