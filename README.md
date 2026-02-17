# 3D Garden

A comprehensive Three.js application with advanced features including Xbox controller support, intelligent terrain collision, ocean LOD system, player movement, HUD interface, and extensive debugging tools.

This boilerplate is supplementary to <!--my book titled [**Three.js and TypeScript**](https://amzn.to/3FahROZ) and--> my **ThreeJS and TypeScript** courses at [Udemy](https://www.udemy.com/course/threejs-tutorials/?referralCode=4C7E1DE91C3E42F69D0F) and [YouTube (Channel membership required)](https://www.youtube.com/playlist?list=PLKWUX7aMnlEKTmkBqwjc-tZgULJdNBjEd)

[Introductory Video](https://youtu.be/cZWAqrJhtvQ&list=PLKWUX7aMnlEKTmkBqwjc-tZgULJdNBjEd)

[Course Discount Coupons](https://sbcode.net/coupons#threejs)

## 📖 Instructions & Controls

For detailed instructions on how to use this boilerplate, including all controls, console commands, and features, see **[INSTRUCTIONS.md](INSTRUCTIONS.md)**.

## Boilerplate Overview

This enhanced boilerplate includes:
- **Ocean LOD System**: Infinite ocean with realistic water simulation
- **Player Movement**: WASD controls with collision detection
- **Character Animation System**: Skeletal animation pipeline for GLB/GLTF clips (Quaternius Universal Animation Library)
- **Animation State Machine**: Priority-based FSM that maps player state to animation clips with crossfade transitions
- **Advanced Shaders**: Unique shader materials for each object
- **Debug System**: Comprehensive debugging tools and GUI
- **Performance Monitoring**: Real-time performance tracking
- **Collision System**: Physics-based collision detection
- **Camera Management**: System and player camera modes

### Character Animation Setup

1. Download the [Quaternius Universal Animation Library](https://quaternius.com/packs/ultimateanimatedcharacter.html) (free).
2. Place `UAL1_Standard.glb` (packed, 45 clips) in `public/models/animations/quaternius/`.
3. The system auto-loads all clips and retargets them to the Rigify character skeleton via bone remapping.
4. Press **`` ` ``** (backtick) in-game to open the **Animation Browser** — scroll through clips, adjust speed, test retargeting.
5. See [INSTRUCTIONS.md](INSTRUCTIONS.md) for the full Blender workflow, bone mapping table, and architecture docs.

[Example](https://sean-bradley.github.io/Three.js-Boilerplate-TS-Vite/)

![](docs/screengrab.jpg)

## Installing

```bash
git clone https://github.com/babylon-detective/3D-Garden.git
cd 3D-Garden
npm install
```

### Develop

```
npm run dev
```

Visit [http://localhost:5173/](http://localhost:5173/)

### Build Production

```bash
npm run build
npm run preview
```

Visit [http://localhost:4173/](http://localhost:4173/)

### Deploy to GitHub pages

If you forked this repository, then you can publish your changes to GitHub pages.

```bash
npm run deploy
```

Visit `https://<your github username>.github.io/3D-Garden/`

E.g.,

[https://sean-bradley.github.io/Three.js-Boilerplate-TS-Vite/](https://sean-bradley.github.io/Three.js-Boilerplate-TS-Vite/)
