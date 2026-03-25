# Battle Camera System — Design & Implementation Notes

This document summarizes the recent redesign of the battle camera system (cut-based, punchy edits) and provides integration and migration notes for engineers.

**Overview**

- Design philosophy: prefer hard cuts between fixed camera positions to prioritize readable, punchy combat beats. Smooth motion is limited to the opening cinematic; in-turn events use instant cuts ("manga-panel" rhythm).
- Two modes: Menu/Idle (readable, ¾ isometric) and Event shots (attacker/impact/reaction/enemy-focus/etc.).

**New Shot Types (BattleShotType)**

- `menuIdle` — ¾ isometric overview; the base menu camera framing for turns and UI clarity.
- `attackerFocus` — medium low-angle on the acting player (wind-up emphasis).
- `strikeImpact` — tight shot focused on the point of melee impact.
- `targetReaction` — cut to the target receiving hit (recoil/damage flash).
- `enemyFocus` — low-angle dramatic framing for enemy attacks.
- `playerReaction` — player receiving hit (mirrors `targetReaction`).
- `deathHold` — wider deliberate hold for enemy death animations.
- `wideAction` — broad framing for spells/area effects.
- `overShoulder` — utility behind-player-to-enemy shot (kept for transitions).

Legacy aliases remain supported: `establishing`, `playerCloseUp`, `enemyCloseUp` map to equivalent new shots.

**Shot Semantics**

- Default behavior: hard cuts (instantly place camera at computed `pos`/`lookAt`) and hold for the configured `duration`.
- Optional interpolation: shots may opt into smooth interpolation by setting `hardCut: false` on the `BattleCameraShot`.
- Opening cinematic: a single smooth sweep from a low-angle start to the `menuIdle` view; duration shortened to 2s.

**Default FOVs**

- `menuIdle`: 48
- `attackerFocus`: 38
- `strikeImpact`: 34
- `targetReaction` / `playerReaction`: 40
- `enemyFocus`: 36
- `deathHold`: 44
- `wideAction`: 52
- `overShoulder`: 50

(These defaults are defined in `src/systems/BattleCameraController.ts`.)

**Player / Enemy Sequences (high-level)**

- Player attack flow:
  1. `attackerFocus` — wind-up and player attack anim.
  2. `strikeImpact` — player teleports to strike range; impact happens and damage is applied.
  3. `targetReaction` (or `deathHold`) — enemy shows damage/death.
  4. return to `menuIdle` (or remain on `deathHold` for defeated targets).

- Enemy attack flow:
  1. `enemyFocus` — dramatic low-angle on enemy (attack anim).
  2. `playerReaction` — player receives hit, damage displayed.
  3. `menuIdle` — return to overview and unlock input.

These sequences are implemented in `src/systems/BattleSystem.ts`.

**API / Data Structure Changes**

- `BattleCameraShot` now includes `hardCut?: boolean` (default true). When `hardCut` is true, the controller instantly positions the camera; otherwise it interpolates during the shot.
- `BattleShotType` expanded to include the new semantic shot names. Old names remain accepted as aliases.
- `BattleCameraController` uses `playSequence(shots: BattleCameraShot[])`, `cutTo(type: BattleShotType)`, and `skipSequence()` as before, but `cutTo` now uses `menuIdle` and other new shots.

Key edited files:
- [src/systems/BattleCameraController.ts](src/systems/BattleCameraController.ts)
- [src/systems/BattleSystem.ts](src/systems/BattleSystem.ts)
- [src/systems/CameraManager.ts](src/systems/CameraManager.ts)

**Integration Notes**

- `BattleSystem` now composes sequences using the new shot types. The controller defaults to hard cuts — sequences should be designed with instant cuts in mind.
- To keep combat snappy, keep most shot durations short (0.2–0.4s). Reserve longer holds for deaths or important events.
- For any skill that needs a wider frame (AOE spells), use `wideAction` with a longer duration and `hardCut: true`.

**Migration Guidance**

- Any code that previously referenced `establishing`, `playerCloseUp`, `enemyCloseUp` will continue to work — those names are still accepted (aliases). Prefer the new semantic names when authoring new sequences.
- If you previously relied on lerped camera motion between shots, explicitly set `hardCut: false` on the `BattleCameraShot` and ensure durations accommodate interpolation.

**Testing & QA**

- Playthrough checklist:
  - Enter battle and verify opening cinematic ends at the ¾ `menuIdle` view.
  - Trigger a player attack — verify the sequence: `attackerFocus` → `strikeImpact` → `targetReaction` (or `deathHold`).
  - Trigger an enemy attack — verify: `enemyFocus` → `playerReaction` → `menuIdle`.
  - Test skip behavior: rapid taps while camera is busy should invoke `skipSequence()` and return to `menuIdle`.
  - Test magic/AOE skills with `wideAction` to ensure effects remain readable.

**Notes for Designers / Animators**

- Keep attack and impact keyframes short and readable at the chosen shot distances. Tight shots (`strikeImpact`) favor clear silhouettes and a single dominant motion.
- Death animations should have a clear pose intended to be held by `deathHold` for visibility.

---

If you'd like, I can also add example sequences (JSON snippets) for common skills and a small visual test harness to cycle through shots interactively. Let me know which you'd prefer next.