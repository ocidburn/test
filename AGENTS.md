# AGENTS.md

Personal Wrocław transit app: Expo SDK 58 (React Native 0.88), TypeScript, no backend.
Read README.md for the layout.

## Commands

```bash
npm test                 # jest + sql.js, no network
npm run typecheck        # app + tests
npx expo lint
EXPO_OFFLINE=1 npx expo install <pkg>   # SDK-compatible versions; offline when api.expo.dev is unreachable
npx expo export --platform ios --platform android   # proves Metro can bundle
```

Run lint, typecheck and tests before committing.

## Rules

- `src/core` must not import React Native or Expo. Everything there runs in Node tests
  through the `Db` interface; platform code lives in `src/platform`.
- Never hardcode a GTFS download URL. Snapshots are discovered from the city's data API
  (`api.open-data.cui.wroclaw.pl/od2/6/`), and the one **in force today** is chosen —
  the archive contains future-dated timetables. See `src/core/gtfs/catalogue.ts` and `update.ts`.
- Look GTFS tables up by file name (`findEntry`), not path: some archives nest them in a folder.
- A failed download or a non-zip answer is transient and must not be remembered as invalid;
  only an archive that parsed and is incomplete is.
- Never replace the working timetable database until the new import has completed.
- Times: use `src/core/time/warsaw.ts`, never `Date#getHours()` or Intl time zones.
  GTFS times can exceed 24:00 and belong to the previous service day.
- HTTP: use `src/core/net/http.ts`; its timeout covers reading the body.
- Do not add entitlements that a free Apple ID cannot sign (push, App Groups, iCloud).
  The arrival alert, when it comes, is a local notification.
- `ios/` and `android/` are generated (`expo prebuild`); configure through `app.json` and plugins.
- Code ported from wroclaw-mpk-map must come from MIT commit `b11fe19` only, with a header
  note and an entry in NOTICE.

## Expo docs

Expo changes every SDK; check the installed package's `.d.ts` or the versioned docs
(`https://docs.expo.dev/versions/v58.0.0/`) instead of relying on memory.
