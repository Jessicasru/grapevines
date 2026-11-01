# Grapevines

Build a mobile-first web app for wine trip recommendations. 

Map: 
- Use Mapbox GL JS for the map. Keep all map logic in a single WineMap component. - Read the Mapbox public access token from an environment variable (VITE_MAPBOX_TOKEN). Ask me for the token. 
- Use the Mapbox Standard style for now. 
- Use Mapbox's built-in clustering on the wineries GeoJSON source so wineries cluster when zoomed out. Tapping a cluster zooms in on it. 
- Add a "Near me" button using Mapbox GeolocateControl. Below the map, list the closest wineries with distance. 
- Add a region selector at the top. Selecting a region animates the map to that region using flyTo.

Core screens: 
1. Map view as described above, with winery pins that open a preview card.
2. Winery detail page: name, region, address, photo, practical info (appointment required yes/no, tasting fee, languages spoken, ships abroad yes/no, opening days), and a list of recommendations. 
3. Add recommendation form: author name, personal note, wines to try, verdict (Go / Skip). 

Data: 
Use Supabase with three tables: 
- regions (name, country, center latitude, center longitude, default zoom) 
- wineries (linked by region_id, with latitude and longitude columns) 
- recommendations (linked by winery_id) No login for now. Seed one region with 10 example wineries. Start with the Alsace, France.

Style: warm, editorial, clean. Think travel magazine, not booking site.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://grapevines.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/a0a58c9b-0f4e-4eea-a247-b6ab4c5de053).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
