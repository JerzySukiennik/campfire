# Campfire

A realistic, interactive 3D campfire that runs in the browser. Sit in a dark forest clearing, stack logs, poke the embers, toast a marshmallow, or put the whole thing out with a bucket of water.

## Features

- **Volumetric fire**: raymarched through a 3D noise volume and shaped by every burning log, so flames follow the wood when you move it.
- **Burn simulation**: each log end has its own heat, char and fuel. Fire spreads along a log and jumps to logs nearby. Logs shrink, crack into glowing alligator char, break apart into the coal bed, and smoulder when you pull them out. The coal bed has its own heat and fuel.
- **Physics** (Rapier): grab logs, throw them, drop new ones from the woodpile. Logs bounce off the stone ring and kick up sparks when they land in the coals.
- **Light**: a flickering point light with soft cube shadows that moves with the flames, plus an unshadowed coal glow.
- **Particles**: motion-blurred sparks, embers that rise on the plume, smoke and steam lit by the fire, and water drops.
- **Post-processing**: HDR pipeline with heat haze, dual-filter bloom, ACES tone mapping, film grain and dithering.
- **Audio**: CC0 recordings of a campfire and a night forest, spatialised fire sound, procedural crackles synced to sparks, wind, hiss and breath.

## Controls

| Tool | What it does |
|---|---|
| Hand `1` | Drag logs (scroll to lift or lower them), click the fire to stir it, press and hold on the embers to blow on them |
| Add log `2` | Take a log from the pile and drop it where you want |
| Water `3` | Hold to throw water. The fire hisses, steams, and the logs stay wet for a while |
| Match `4` | Light a log or the embers |
| Marshmallow `5` | Toast it over the flames. Scroll to raise or lower it, click to blow it out if it catches fire, press `E` to eat it |

Drag to look around, scroll to zoom, `M` to mute. URL flags: `?low`, `?high`, `?debug`.

## Tech

Plain ES modules, no build step. three.js 0.186 and Rapier 0.21 are loaded from a CDN. Textures are generated procedurally (`src/textures.js`) and baked once to WebP with `Niepotrzebne/bake/bake.mjs`.

Audio credits are in `audio/CREDITS.md`.
