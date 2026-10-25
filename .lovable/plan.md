# Show France's shape in the world overview

## What changes
- **France's shape returns** in the most zoomed-out world view: a soft burgundy fill with a thin outline, so wine countries read at a glance from Australia to Argentina.
- **Region shapes keep today's behaviour**: hidden in the most zoomed-out view, appearing as you zoom in, fading to a light tint at village level and gone at winery level.
- Clicking France in the overview still flies there.

## Technical details
- `WineMap.tsx`: remove `minzoom: 2` from `country-fill` / `country-line`; fill-opacity `0 → 0.3, 3 → 0.3, 4 → 0`, line-opacity `0 → 0.7, 3 → 0.7, 4 → 0.15`.
- `boundary-fill` / `boundary-line` unchanged.
- Allow country clicks from zoom 0.
- Add the task to roadmap.md during build.
- Verify with Playwright on desktop and 390px mobile at the opening view; run existing map tests.
