# Mind Care

A student-made wellbeing website for everyone. It includes a topic-menu screen with separate pages for mood check-ins, small stress tools, sleep wind-down ideas, helpline links, an about page, and an optional AI chat.

The About page credits developers Naveen Kumar, Dilshaj Ashrafi, Gaurav Raj, and Abhishek Kumar Singh (B3/B210 · BTech CSE (AI)). Confirm the country-specific support details match the people who will use the site.

## Languages and display

The interface offers English, Hinglish, and all 22 languages in India's Eighth Schedule. All 23 additional language packs are generated during the site build and bundled with the app, so visitors never need a language-download button or pack-by-pack download. After the first online visit installs the service worker, all interface languages are cached for offline use. The initial pack build sends only public interface strings to Google Gemini; journal entries, chat history, feedback, plans, and saved contacts are not included. Translation can be imperfect, so check urgent support information against official sources.

Generating all packs makes 23 Gemini requests and uses the site owner's API quota. The build pauses between groups to respect rate limits and can take several minutes. Pack files are reusable build assets: after generating them, keep the `language-packs/` directory with the site source so future builds can reuse the packs unless interface text changes. A first visit must stay online long enough for the service worker to install and cache the app and every pack. Service workers require HTTPS on a deployed site or localhost during local development. AI chat remains online-only.

The light/dark theme, larger-text setting, and higher-contrast setting are saved in the current browser. Saved preferences and wellbeing entries are local to that browser and may be visible to others using the same device.

## Run locally

Use Node.js 20 or newer. The site has no third-party package dependencies.

In PowerShell, set the Gemini API key for this terminal session, build the language packs, and start the local server:

```powershell
$env:GEMINI_API_KEY = "your-key-from-Google-AI-Studio"
npm run build
node server.js
```

Then open `http://localhost:3000`. The initial language-pack build requires `GEMINI_API_KEY`; without it, the build stops instead of shipping an app that falsely claims every language is installed. Keep the generated `language-packs/` files when deploying.

Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey). Keep it secret. Never put it in `index.html`, `script.js`, or a committed file. The server-side chat and translation endpoints read it from `GEMINI_API_KEY`.

## Deploy to Netlify or Vercel

Both hosts serve the same static app, bundled language packs, and serverless API routes. The build command is `npm run build`; on the first build, provide `GEMINI_API_KEY` so the pack generator can create all locale files. Generated packs are public static assets and contain only translated interface text.

### Netlify

Deploy this project folder as the Netlify site base directory. In **Site configuration → Environment variables**, add `GEMINI_API_KEY` with your Gemini API key before the first build. `netlify.toml` runs the pack build and maps `/api/chat` and `/api/translate` to their functions in `netlify/functions`.

### Vercel

Import this project folder as the Vercel project root. `vercel.json` runs `npm run build` and publishes the app and generated pack files from the project root. In **Project Settings → Environment Variables**, add `GEMINI_API_KEY` before the first build for the selected environments. Vercel detects `api/chat.js` and `api/translate.js` as Node.js functions and serves them at `/api/chat` and `/api/translate` alongside the static site.

Do not commit the key to either host's source code, and do not add it to the browser's public environment variables.

## Chat privacy and safety

Chat messages are sent to Google Gemini to generate a reply. This website does not store the conversation; chat history is held temporarily in the current page and disappears when it is reloaded or closed. Avoid sharing names, addresses, passwords, or other identifying details. The chat is AI-generated, is not a therapist, cannot diagnose, and cannot contact emergency services. It is not a substitute for professional help. In India, call **112** for an emergency or **14416** for Tele-MANAS; elsewhere, use your local emergency number or [findahelpline.com](https://findahelpline.com/).

The one-time language-pack build sends the site's built-in interface strings to Google Gemini. User-written journal content, chat history, feedback, plans, and saved contacts are not part of translation requests. Translation packs are static files bundled with the site and cached for offline use by its service worker.

## Checks

Run the built-in tests with:

```powershell
node --test
```
