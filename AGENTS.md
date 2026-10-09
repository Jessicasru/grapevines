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
- Data reads go through queryOptions in src/lib/wine.ts so loaders and components share one cache.
- Use stacked content by default and page-level grid layouts at large breakpoints; keep map resizing inside WineMap so viewport changes preserve the interactive canvas.
