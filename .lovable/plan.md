# Show France and active wine regions in the world overview

## What changes
- **France's shape returns** in the most zoomed-out world view: a soft burgundy fill with a thin outline, so wine countries read at a glance from Australia to Argentina.
- **Regions with wineries show their shapes in the overview too** (e.g. Alsace), drawn on top of the country fill, slightly stronger so they stand out.
- Only regions that already have at least one winery and an uploaded boundary are drawn; empty regions stay hidden.
- Zooming in keeps today's behaviour: country fill fades out around country level, region shapes fade to a light tint at village level and disappear at winery level.
- Clicking France or a region shape in the overview still flies there.

## Technical details
- `WineMap.tsx`: remove `minzoom: 2` from `country-fill` / `country-line`; fill-opacity `0 → 0.3, 3 → 0.3, 4 → 0`, line-opacity `0 → 0.7, 3 → 0.7, 4 → 0.15`.
- `boundary-fill` / `boundary-line`: remove `minzoom: 3`; opacity starts at zoom 0 (fill 0.4, line 0.7) instead of 0 at zoom 3, then the existing curve.
- Filter the `boundaries` source to regions whose id appears in the loaded wineries (recommended + base).
- Allow country/region clicks from zoom 0.
- Verify with Playwright on desktop and 390px mobile at the opening view; run existing map tests.
