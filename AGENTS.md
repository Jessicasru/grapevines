<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- All Mapbox logic lives in src/components/WineMap.tsx, with mapbox-gl dynamically imported so SSR never loads it.
- Map selection is controlled by the map route and shared with WineMap; render pins from the same ordered directory entries so numbers and selection stay aligned.
- Data reads go through queryOptions in src/lib/wine.ts so loaders and components share one cache.
- A persistent pathless _map layout owns the map and Framer Motion LayoutGroup; leaf winery routes provide metadata and identify the detail overlay so navigation preserves the camera and carousel. WineMap alone captures and restores camera state.
- The map route uses one layout at every size: full-screen canvas, floating pill header, snapping bottom card carousel (.map-carousel, read by WineMap for padding) and a full-list bottom sheet; keep map resizing inside WineMap. Radius, shadow and accent come only from the shared tokens in styles.css.
- WineMap owns a single Mercator map, zoom-driven country/region/winery layers, terrain and overlay-aware camera restoration; location selection requests camera movement without remounting the map. World contain-fit uses Mapbox's internal allowWorldUnderZoom flag because its default Mercator constraint crops continents on portrait screens; keep this compatibility point tested on SDK upgrades. Country reference data is bundled for deterministic ISO codes and bounds.
- Auth state lives in src/lib/auth.tsx (AuthProvider + requireAuth); gated actions call requireAuth instead of redirecting, because every screen is public.
- "Recommended" is computed client-side by isRecommended in src/lib/wine.ts so carousel, pins and tests share one rule.
- Avatars are stored as small resized data URLs on profiles, because public storage buckets are blocked in this workspace.
- A winery belongs to the nearest region outline within 2 km. region_for_point decides it, for imports and outline uploads alike, so upload order does not matter where regions nearly touch (Champagne and Bourgogne). Each outline is stored a second time in region_areas, one row per vineyard area widened by 2 km, because measuring from the full outline for every row was too slow. The OpenStreetMap import runs one region at a time over half-degree tiles around its vineyards (one box around the Loire would cover a third of France), and imports reach the database in batches of 500. Duplicate review also runs one region at a time; the candidate, preview and apply functions take an optional region, and without one they cover every region, as the distance rerun expects. Region outlines and DATAtourisme files are built by scripts/data; see data/README.md.
- CSV imports use Papa Parse and an authenticated server function calling an admin-checked database RPC; geography filtering and serialized source matching live in the RPC so repeat and concurrent uploads remain idempotent.
- Duplicate classification and mutations live in admin-checked database RPCs with serialized preview tokens; cross-source uniqueness is checked against the complete candidate graph, retaining different-address precedence. Soft merges snapshot both wineries and linked rows, including coordinate overrides in after-state; guarded Undo avoids overwriting later edits. All winery reads exclude merged_into rows; history reads use dedicated admin RPCs. Compact pair maps remain in WineMap.tsx.
- Duplicate distance eligibility uses one shared database helper; explicit restoration of distance-dismissed pairs creates a manual-only exception so Restore to list remains effective without weakening automatic rules. One-off requested reruns persist their summary and are idempotent.
