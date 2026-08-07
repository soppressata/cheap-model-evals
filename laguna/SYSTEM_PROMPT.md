# Paper Glider: Endless Flight — Design Constitution

> Lead Arcade Game Agent build directive. This file is the immutable design constitution for the project.

## Vision
Fold a paper airplane and throw it into an endless, beautiful void. Glide through procedural
landscapes, trade altitude for speed, thread glowing rings to build a multiplier, and dodge
jagged spires. Earn coins to unlock new planes and customize their folds and patterns.

## Core Loop
launch → steer & boost → collect rings & dodge terrain → crash → upgrade/customize → repeat

## Priority Order (non-negotiable)
1. **GAME FEEL / FLIGHT PHYSICS** — buttery-smooth steering, momentum balance (airborne arcade).
2. **GRAPHICS / ATMOSPHERE** — premium indie look: stylized low-poly, PBR lit, glassmorphism UI.
3. **FUNCTIONALITY** — procedural generation, collision, upgrades, progression.
4. Everything else.

## Tech Stack (FIXED)
- Vite + vanilla JavaScript ES modules
- Three.js (WebGL2)
- Tailwind CSS + Lucide Icons for UI
- Procedural canvas textures, procedural Web Audio
- UI/HUD in plain HTML/CSS overlays over the `<canvas>`
- Zero external image/audio/model assets (no .png/.mp3/.glb)

## File Layout
```
paper-glider/
├── SYSTEM_PROMPT.md        # this file
├── index.html              # all UI overlays
├── src/
│   ├── main.js             # boot + state machine + UI wiring
│   ├── Game.js             # render loop, chunk manager, collision, score
│   ├── world/
│   │   ├── Terrain.js      # fBM noise, chunk pooling, biome data
│   │   ├── Environment.js  # sky dome shader, sun, lighting, fog
│   │   └── Features.js     # rings, spires, arches
│   ├── player/
│   │   ├── Airplane.js     # procedural plane mesh, physics, steering
│   │   ├── Trails.js       # ribbon contrail
│   │   └── Cosmetics.js    # canvas texture generation
│   └── systems/
│       ├── AudioEngine.js  # synthesized audio
│       ├── Particles.js    # additive particle system
│       └── Storage.js      # localStorage wrappers
```

## Biome Definitions
1. Sunset Canyon — warm oranges/reds, jagged mesas, stone pillars + archways
2. Frost Caverns — pale blues/whites, ice, floating stalactites + frozen tunnels
3. Neon Metropolis — midnight sky, flat dark ground, glowing grid, neon skyscrapers
4. Emerald Archipelago — daylight sky, water shader, rolling green island bumps

## Acceptance Tests
T1–T12 as specified in the agent brief (title screen → persistence → 60 FPS).

## Scope Guardrails (DO NOT BUILD)
Multiplayer/leaderboards, weapons, external model loading, external physics engines,
.env files.
