# Share images

The Worker draws nearby vector polygons from the R2 PMTiles archive.
It reads the archive zoom range and feature properties at request time.
The display uses zoom 16 scale with tiles from zoom 15 or the archive maximum,
whichever is lower, and excludes polygons outside the card before rendering.
This keeps the SVG small enough for resvg in the local Worker runtime.
The selected footprint has a white outline.
Selection uses the building ID first, then containment or the nearest vertex.
The query year is validated display data, not an authoritative building record.

The PNG renderer is `@resvg/resvg-wasm` 2.6.2.
Wrangler bundles its WASM module and the 36,164-byte Anton font subset.
The font is from Google Fonts and uses the SIL Open Font License in `fonts/OFL.txt`.
The subset contains ASCII, the middle dot, and the em dash.
To recreate it, download `ofl/anton/Anton-Regular.ttf` from google/fonts,
then run this command with fonttools:

```sh
uvx --from fonttools pyftsubset Anton-Regular.ttf \
  --output-file=worker/fonts/Anton-subset.ttf \
  --unicodes=U+0020-007E,U+00B7,U+2014 --layout-features='*'
```

The card cache key contains normalized selection parameters,
the archive ETag, and the calendar year used for the displayed age.
Only URLs with the current archive and calendar versions get immutable caching.
Unversioned requests use a five-minute browser cache.
`X-OG-Cache` reports a Cache API hit or miss for local verification.
Invalid parameters or unavailable archive data fall back to the static image.
Only valid GET requests for `/` change the social metadata.
The canonical URL remains unchanged.

The static endpoint contains the README screenshot on `#050506`.
It uses the existing Astro raster service with PNG palette compression.
The original README screenshot remains at its existing path.

Uncached renders use an in-isolate budget: a burst of six, refilling at six
per minute, with at most two concurrent renders.
Cache hits consume no budget, and identical concurrent misses share PNG bytes.
Selections round coordinates to six decimals before forming the cache key.
Over-budget requests redirect to the static image without loading card tiles.
This is a mitigation under the edge cache, not an account-wide guarantee.
The retained `/og-image.jpg` is a legacy URL; new metadata uses `/share.png`.
