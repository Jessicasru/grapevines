# Grapevines

## What this is

Grapevines (working name) helps wine lovers plan trips to wine regions: a map of visitable wineries, with honest recommendations from people who have been there. It is not a travel journal. Recommendations are public to everyone.

Live at grapevines.lovable.dev. Current focus: Alsace only. Other regions come after Alsace is complete.

## How to work in this repo

- Lovable syncs with `main`, so anything merged there goes live. Never push to `main`. Work on a branch and open a pull request.
- One task per pull request. Keep changes focused on that task.
- Each task comes with a "Done when" condition. Meet it, and say in the pull request how you checked.
- In the pull request, list anything Jessica must do by hand, such as applying a database change or adding a secret.
- If a task is unclear, ask in the pull request instead of guessing.

## Product principles

- No AI slop. No generated filler text, invented reviews, placeholder wineries or stock images. An honest empty state beats invented content.
- Every winery has a source and a verification date.
- Visitors give a Go / Skip verdict, not stars.
- Agents gather data; the review queue decides what goes live. Nothing an agent finds is published without review.

## Data rules

- Winery sources: OpenStreetMap, DATAtourisme, Overture.
- Credit OpenStreetMap on the map (ODbL). Credit DATAtourisme as a source (Licence Ouverte 2.0).
- Google Places is for enrichment only, never the source of the winery list. Never store Google photos.
- Don't scrape winery websites or copy their images without permission.
- Imports must be safe to rerun: a rerun creates no duplicates.

## Tech

Built in Lovable, with Supabase as the backend and Mapbox for the map. The admin area (/admin) is open to Jessica's account only.

Read `AGENTS.md` before you change the map, the imports or the duplicate review. It explains why the code is built the way it is.

### Stack

- **App:** TanStack Start (React 19) with file-based routes and server functions. Vite builds it through `@lovable.dev/vite-tanstack-config`, which already includes the Vite plugins. Don't add them again in `vite.config.ts`.
- **Data fetching:** TanStack Query.
- **Backend:** Supabase (Postgres, auth and database functions).
- **Map:** Mapbox GL JS, with clustering and terrain.
- **UI:** Tailwind CSS 4, shadcn/ui components (Radix), Framer Motion for map and card animations.
- **Tests:** Vitest with Testing Library and jsdom.
- **Package manager:** Bun (`bun.lock`). `bunfig.toml` blocks package versions that are less than 24 hours old.

### Folder structure

| Path | What it holds |
| --- | --- |
| `src/routes/` | File-based routes. `_map.tsx` is the layout that owns the map. `_map.index.tsx` is the home page and `_map.wineries.$id.tsx` is the winery detail. `admin*.tsx` are the admin pages: wineries, import, duplicates and regions. `routeTree.gen.ts` is generated, so don't edit it. |
| `src/components/` | `WineMap.tsx` holds all Mapbox logic. `WineryDetail.tsx` shows a winery and its recommendations, and visitors add their own recommendation there. `src/components/ui/` holds the shadcn/ui components. |
| `src/lib/` | Data and logic. `wine.ts` holds all data reads, the "recommended" rule and distance. `auth.tsx` holds login state. The `*.functions.ts` files are server functions for imports and duplicate review. Tests sit next to the code they test. |
| `src/integrations/supabase/` | Supabase clients and generated database types. Lovable generates these files, so don't edit them. |
| `drizzle/migrations/` | One SQL file per database change. `drizzle/schema.ts` is empty on purpose. |
| `supabase/config.toml` | The Supabase project ID. |

### How data gets from Supabase to the map

1. `src/lib/wine.ts` defines each read as a TanStack Query `queryOptions`: regions, wineries and region boundaries. The wineries query also gets the verdict of each recommendation and leaves out merged duplicates.
2. The loader of the `_map` layout route loads regions and wineries before the page shows. Components read the same cache, so the data loads once.
3. `_map.tsx` gives the wineries to `WineMap`, which turns them into a GeoJSON source that Mapbox clusters.
4. `isRecommended` in `wine.ts` decides which wineries show as recommended. Pins, cards and tests all use this one rule.

Data goes back into Supabase in three ways:

- **Recommendations:** a visitor logs in and adds a Go / Skip verdict in the winery detail. Anyone can read a page; only actions that write data ask for a login.
- **Imports (admin):** the OpenStreetMap import gets wineries in the Alsace area from the Overpass API. The CSV import reads a file with Papa Parse. Both call a server function, which checks that the user is an admin and then calls a database function (`import_osm_wineries` or `import_csv_wineries`). The database function matches rows on their source, so a rerun updates rows instead of adding duplicates.
- **Duplicate review (admin):** database functions find possible duplicates, merge them and undo a merge.

Admin access comes from the `is_admin` column on the `users` table. The `is_admin()` database function reads it. `/admin` shows "not found" to all other users, and every admin database function checks `is_admin()` again.

### How to run and test

`.env` holds the Supabase URL, the Supabase publishable key and the Mapbox token. These values are public, so the file is in the repo. Lovable manages it.

```sh
bun install
bun run dev      # start the app locally
bun run test     # run the tests once
bun run lint     # check the code style
```

The database tests in `src/lib/*.integration.test.ts` skip unless you set `SUPABASE_DB_URL` and `RUN_CSV_DATABASE_TESTS=1` or `RUN_DUPLICATE_DATABASE_TESTS=1`. Some of them write to the database they connect to, so never point them at the live database.

A database change goes in a new SQL file in `drizzle/migrations/`. List it in the pull request, because Jessica applies it by hand.
