# HomeyPaw Website

Lightweight bilingual public website for HomeyPaw. It contains no authentication, database, analytics, tracking, advertising, cookies, or third-party pet imagery.

## Routes

- `/`
- `/privacy`
- `/terms`
- `/support`

Traditional Chinese (`zh-HK`) is the default. The language switcher stores only the user's language preference in `localStorage` and keeps the current route.

## Local development

Use Node 22.13 or newer. From this directory:

```sh
npm install
npm run dev
```

Validation:

```sh
npm run typecheck
npm run lint
npm run build
```

## Deployment boundary

`vercel.json` provides a fallback so `/privacy`, `/terms`, and `/support` can be opened directly. Do not add public URLs to the HomeyPaw app or App Store metadata until the deployed HTTPS pages have been verified without authentication.
