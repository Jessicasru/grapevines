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
- The map route uses one layout at every size: full-screen canvas, floating pill header, snapping bottom card carousel (.map-carousel, read by WineMap for padding) and a full-list bottom sheet; keep map resizing inside WineMap. Radius, shadow and accent come only from the shared tokens in styles.css.
