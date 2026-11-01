## Next

- [ ] One-tap 'been here' from the map card or detail, with an optional visit date, no review needed.
- [ ] My map: a toggle that shows only my been-here and saved wineries, with distinct pins and a count per region.
- [ ] Near me and along my route: closest visitable wineries by distance; route mode with start and end showing wineries within a set detour.
- [ ] Factual winery fields: walk-ins (yes / appointment / unknown), opening hours, organic/biodynamic, tasting fee, each with a source and check date; admin can edit; unknown shows as unknown.
- [ ] Filters: open now, walk-ins OK, organic; honest empty state.
- [ ] Visited and saved counts on winery cards, hidden below a minimum count; sortable.
- [ ] Curated lists (e.g. 'Jessica's Alsace day') that visitors can open on the map.
- [ ] Decide what happens to Go / Skip (private, optional or removed) after the been-here and My map items are used.

## Done

- [x] Rename profiles to users and migrate app user IDs to sequential integers starting at 0, preserving sign-in, ownership and existing data.
- [x] Restore centered header/profile color; remove Whole world choice and duplicate country labels; fit all wine countries without opening polygons.
- [x] Replace map modes with Mercator hierarchy, country/region bounds selector and zoom-driven terrain; verify desktop/mobile and details.
- [x] Add fitted world overview, clickable regions, faded globe/terrain entry, Back to world and resize handling; verify mobile, desktop and detail navigation.
- [x] Simplify overview to soft fill and red markers; fade grey dots in, hide polygons at zoom 13.5, verify three levels on phone/desktop.
- [x] Apply zoom-based grey-dot and wine-area emphasis; preserve opening bounds and verify overview, zoom 11 and zoom 14 on phone/desktop.
- [x] Show grey and red wineries together on opening, scale grey dots with zoom, fit all regional wineries at max zoom 11, and verify mobile/desktop.
- [x] Update 60 m / 300 m same-domain rules, dismiss excluded pending pairs, rerun automatic handling and verify counts.
- [x] Add mutually unique OSM–DATAtourisme preview rule, OSM coordinates with Undo, and manual source breakdown; verify.
- [x] Add address preview/Apply, reversible merges, Merged/Dismissed history and keyboard duplicate review; verify.
- [x] Add admin duplicate candidates, pair maps, manual merge and permanent dismissal; verify rules and flows.
- [x] Add admin CSV imports with source matching, preserved details, boundary filtering, summaries and DATAtourisme credit; verify.
- [x] Quiet Mapbox Standard styling and numbered clustered pins.
- [x] Link winery selection between map, list, and preview; fit region bounds.
- [x] Remove separate Near me button, retain built-in location control, and verify interactions.
- [x] Open shareable winery details over a persistent map with shared photo/name/tag transitions.
- [x] Restore the exact camera on close; verify desktop, mobile, direct links, and reduced motion.
- [x] Restore consistently burgundy, proportionate pins and verify zoomed-out cluster counts and expansion.
- [x] Accounts (magic link + Google), profiles, search, add winery, saves, Been here recommendations, My wineries.

- [x] Show wine-country shapes (France) in the world overview; region shapes keep zoom-in behaviour.
