# Island Crisis

A 3D action game built with Three.js featuring Wind Waker–style cel-shaded characters, skeletal animation, heightmap-based terrain collision, multi-LOD ocean, and a custom GLSL shader pipeline. Models and environments are authored in Blender and exported as GLB for runtime consumption.

## Documentation

| Document | Contents |
|----------|----------|
| [INSTRUCTIONS.md](INSTRUCTIONS.md) | Full system architecture — Blender ↔ Three.js pipeline, shaders, collision, animation, controls |
| [public/models/animations/quaternius/README.md](public/models/animations/quaternius/README.md) | Animation clip inventory and retargeting guide |

## Tech Stack

| Component | Version / Tool |
|-----------|---------------|
| Runtime | Three.js `^0.176.0` |
| Language | TypeScript `^5.7.3` |
| Bundler | Vite `^6.3.5` + `vite-plugin-glsl` |
| Shading | Raw GLSL via `ShaderMaterial` (no TSL yet) |
| 3D Authoring | Blender (models, environments, rigging) |
| Animations | Quaternius Universal Animation Library (UAL) |

## Project Structure

```
├── config/
│   ├── animation-sets.json        # Clip registry (file → name mapping)
│   └── levels/                    # JSON level descriptors
├── public/models/
│   ├── characters/                # Character GLBs (Blender → GLB)
│   ├── environments/              # Terrain & island GLBs
│   └── animations/quaternius/     # UAL animation pack
├── scripts/
│   ├── rename_rigify_to_ual.py    # Blender: rename DEF- bones to UAL
│   └── rerig_to_ual_skeleton.py   # Blender: full re-rig to UAL skeleton
├── src/
│   ├── shaders/                   # All GLSL vertex/fragment shaders
│   │   └── common/                # Shared lighting & shadow chunks
│   ├── systems/                   # Game systems (TS modules)
│   └── main.ts                    # Entry point & game loop
└── vite.config.js
```

## Blender → Three.js Pipeline (Summary)

```
Blender                          Three.js Runtime
───────                          ────────────────
Character .blend                 
  │ re-rig to UAL skeleton       
  │ (rerig_to_ual_skeleton.py)   
  └─► .glb (65 UAL bones)  ───► ObjectLoader → PlayerController
                                    │ custom cel-shader (ShaderMaterial)
                                    └─► AnimationMixer + StateMachine
                                    
Environment .blend               
  └─► .glb  ───────────────────► ObjectLoader → land shader
                                    └─► HeightmapCollider (baked grid)
                                        └─► CollisionSystem (O(1) queries)

UAL1_Standard.glb (45 clips) ──► CharacterAnimationSystem
                                    └─► AnimationStateMachine (14 states)
```

See [INSTRUCTIONS.md](INSTRUCTIONS.md) for the full pipeline documentation.

## Quick Start

```bash
git clone <repo-url>
cd Island_crisis_three.js
npm install
```

### Develop

```bash
npm run dev
```

Visit http://localhost:5173/

### Build

```bash
npm run build
npm run preview
```

### Deploy to GitHub Pages

```bash
npm run deploy
```
