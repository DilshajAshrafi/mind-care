# Mind Care

A student-made wellbeing website for everyone. It includes separate pages for mood check-ins with a seven-day reflection, a focus/break timer, a daily care checklist, small stress tools, sleep wind-down ideas, helpline links, an about page, and an optional AI chat.

The About page credits developers Naveen Kumar, Dilshaj Ashrafi, Gaurav Raj, and Abhishek Kumar Singh (B3/B210 · BTech CSE (AI)). Confirm the country-specific support details match the people who will use the site.

## Languages and display

The interface offers English, Hinglish, and all 22 languages in India's Eighth Schedule. Choosing a language translates the complete interface using a reviewed bundled pack when one is installed, or the configured online translation service otherwise. A successful online translation is saved in browser/app IndexedDB for that language and can then be reused offline on that device. The first selection of each language requires internet. The app never asks the user to download a language pack. Check urgent support information against official sources.

To generate all 23 non-English locale packs from the current interface, set `GEMINI_API_KEY` privately in your local environment and run `npm run build:packs:online`. The generator validates every translation and placeholder, reuses valid packs, and enables bundled packs only after all locales are complete. Generated packs are included in website builds and the Android app, so the first language selection can work offline. On an online-only build with no complete pack set, the website uses `/api/translate`; that first translation requires internet and a server-side Gemini key, and is saved on the device for subsequent offline use. Machine translations can be imperfect: have fluent speakers review urgent-support and wellbeing wording before release. AI chat remains online-only.

For human-reviewed translations, run `npm run translations:templates`, have fluent speakers complete each `language-templates/<locale>.json`, then run `npm run build`. This separate strict build only packages complete manual translations and refuses blank, outdated, or invalid locale files; it never calls a translation service.

Each `language-packs/<locale>.json` file contains `language`, `sourceHash`, and a `translations` object with a non-empty translation for every extracted English source string. Keep template tokens such as `{{COUNT}}` unchanged. The `language-packs/manifest.json` file lists the current `sourceHash`, `sourceCount`, and all 23 locale codes. The mobile build refuses to proceed if any pack is absent, stale, incomplete, or changes a template token.

The focus timer runs on the device. Daily care choices reset each day, and the mood summary counts saved check-ins from the last seven days without making health claims. The light/dark theme, larger-text setting, and higher-contrast setting are saved in the current browser. Saved preferences and wellbeing entries are local to that browser and may be visible to others using the same device.

## Run locally

Use Node.js 20 or newer.

In PowerShell, run the site with the local translation backend:

```powershell
$env:GEMINI_API_KEY = "your-key-from-Google-AI-Studio"
node server.js
```

Then open `http://localhost:3000`. To generate and bundle machine translations for offline use, run `npm run build:packs:online` before building or publishing. `npm run build:online` validates and includes a complete generated pack set if one is present; otherwise it prepares the online-fallback build. To produce a site with reviewed human translations, complete the manual templates and run `npm run build`. Without a backend key or completed bundled packs, wellbeing tools work, but a new language cannot be translated offline.

Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey). Keep it secret. Never put it in `index.html`, `script.js`, or a committed file. The server-side chat endpoint reads it from `GEMINI_API_KEY`.

## Deploy to Netlify or Vercel

Both hosts serve the same static app and serverless chat/translation APIs. Their configured online build command is `npm run build:online`, which does not require the manual JSON files. Set `GEMINI_API_KEY` as a private serverless-function environment variable to enable online chat and first-time language translation. The separate `npm run build` command is reserved for fully reviewed packs pre-installed for offline use.

### Netlify

Deploy this project folder as the Netlify site base directory. In **Site configuration → Environment variables**, add `GEMINI_API_KEY` for the chat and translation functions. `netlify.toml` runs the online build and maps `/api/chat` and `/api/translate` to their functions in `netlify/functions`.

### Vercel

Import this project folder as the Vercel project root. `vercel.json` runs `npm run build:online` and publishes the app from the project root. In **Project Settings → Environment Variables**, add `GEMINI_API_KEY` for the chat and translation functions in the selected environments. Vercel detects `api/chat.js` and `api/translate.js` as Node.js functions and serves them at `/api/chat` and `/api/translate` alongside the static site.

Do not commit the key to either host's source code, and do not add it to the browser's public environment variables.

## Android app

The Android app includes the focus timer and daily care checklist; daily care choices and mood history stay on the device. To create an APK with all generated language packs pre-installed, set both the private Gemini key and deployed HTTPS API URL, then run:

```powershell
$env:MIND_CARE_API_BASE_URL = "https://your-deployed-site.example"
$env:GEMINI_API_KEY = "your-key-from-Google-AI-Studio"
npm run build:mobile:android:preinstalled
```

The build translates each missing/stale locale once, validates the packs, then bundles them into the APK, so all included page languages are available offline from the first launch. This generation calls Gemini for fixed interface text; it does not send journal entries or other user data. Machine translations should be reviewed before release. For online translation that is cached on each device only after the user first selects a language, use `npm run build:mobile:android:online` and configure the deployed API URL. For reviewed manual translations, complete the templates and use `npm run build:mobile:android`. Chat also uses the hosted `/api/chat` endpoint. Journal entries, mood history, plans, daily care choices, contacts, feedback, and saved translations remain in the app's local browser storage; this project does not upload those entries or provide account sync.

Install the Android SDK platform/build tools and JDK 21. Deploy the backend to Netlify or Vercel, configure `GEMINI_API_KEY` in that host's environment settings, and use its HTTPS site URL as the mobile API base. In PowerShell:

```powershell
$env:MIND_CARE_API_BASE_URL = "https://your-deployed-site.example"
npm run build:mobile:android
```

The command validates that the HTTPS API URL is configured, copies the static app into `dist`, syncs the Capacitor Android project, and builds a debug APK at `android/app/build/outputs/apk/debug/app-debug.apk`. The chat and translation APIs accept requests from the Android app's local web origin; the Gemini key is never included in the APK. You must redeploy the backend after configuring its secret, and rebuild the APK after changing app assets.

After a successful Android build, the APK is also copied to `downloads/mind-care.apk`. Deploy that file with the website to make the **Get the app** page offer it for download; the page checks whether the file exists and does not show a dead download link. The published package is a debug APK intended for testing and sideloading, not a Play Store release.

## Chat privacy and safety

Chat messages are sent to Google Gemini to generate a reply. This website does not store the conversation; chat history is held temporarily in the current page and disappears when it is reloaded or closed. Avoid sharing names, addresses, passwords, or other identifying details. The chat is AI-generated, is not a therapist, cannot diagnose, and cannot contact emergency services. It is not a substitute for professional help. In India, call **112** for an emergency or **14416** for Tele-MANAS; elsewhere, use your local emergency number or [findahelpline.com](https://findahelpline.com/).

Manual pack creation and bundling do not send text to a translation service. When no completed pack exists for a selected language, the interface's fixed English strings (not journal entries or other user-written content) are sent to Gemini through the server-side translation endpoint. The resulting interface strings are cached locally for offline use. User-written journal content, chat history, feedback, plans, and saved contacts stay in local device storage.

## Checks

Run the built-in tests with:

```powershell
node --test
```
