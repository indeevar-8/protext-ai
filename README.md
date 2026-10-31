# ProText AI — starter v1

A mobile-first PWA starter using WebLLM for local, on-device text rewriting.

## Requirements
- Windows 10/11
- Node.js 20 LTS or newer
- Git (optional)
- iPhone 16 Pro with a recent iOS/Safari version that exposes WebGPU
- Wi-Fi for the first deployment and model download

## Run on your Windows PC
1. Install Node.js LTS from https://nodejs.org/
2. Extract this folder.
3. Open PowerShell in this folder.
4. Run:
   ```powershell
   npm install
   npm run dev
   ```
5. Open the local URL shown by Vite (usually http://localhost:5173).

The local PC preview checks the browser's WebGPU capability. It is not yet an iPhone install.

## Put it on your iPhone
A PWA must be served over HTTPS for service workers and installation. The simplest free route is GitHub Pages:
1. Create a GitHub account and a **public** repository named `protext-ai`.
2. In this project, run `npm install` and `npm run build`.
3. Upload the contents of the generated `dist` folder to the repository root (or deploy the repository with GitHub Pages).
4. Enable GitHub Pages in repository Settings → Pages.
5. Open the resulting HTTPS URL in Safari on your iPhone.
6. Tap Share → Add to Home Screen → Add.

For a Vite project deployed at a GitHub Pages subpath, configure `base` in vite.config.js to `"/REPOSITORY-NAME/"` before building. The included `base: "./"` is suitable for relative assets.

## First AI model download
1. Open the installed PWA while online.
2. Keep it in the foreground and connected to Wi-Fi.
3. Tap Professionalize text once to initialize WebLLM and download the selected model.
4. Wait until the progress reports that the model is ready.
5. Test rewriting while still online.
6. Turn on Airplane Mode, reopen the installed PWA, and test again.

Model download is substantial and is separate from the app shell. The model is cached by WebLLM; iOS may evict website data under storage pressure. Keep the app in the foreground during initial download and do not clear Safari website data.

## Important limitations
- This is a first technical prototype, not a guarantee of compatibility with every iOS/Safari build.
- Safari WebGPU support is partial/version-dependent. If WebGPU is unavailable, local generation will not run; this app intentionally has no cloud fallback.
- Browser/PWA storage can be evicted by iOS. Test offline operation after the first download and periodically.
- iOS may suspend background work. Keep the app open while generating.
- No app-store distribution is included. This PWA is for personal use.
- The initial model is a small 0.5B model. Quality is lower than larger cloud models and should be checked for important messages.

## Privacy
The app does not send the entered text to a backend. WebLLM downloads model files from its configured model host during initial setup. Inference is local. Avoid entering sensitive information until you have verified network behavior and storage on your device.
