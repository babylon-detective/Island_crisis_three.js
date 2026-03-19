# Plan: Battle Camera System Refactor

Refactor CameraManager to remove shoulder mode, demote freeview to hidden debug, and overhaul the battle camera with a dynamic cinematic system: white-flash transitions, a 3-second opening pivot track, 5 distinct camera shot types, and instant-teleport attack sequences at a fixed 8-unit combatant distance.

---

## Phase 1: Clean Up — Remove Shoulder, Demote Freeview

1. **Update `CameraMode` type** — change to `'thirdperson' | 'dialogue' | 'battle'` public, add internal `'freeview'` for debug-only
2. **Remove shoulder camera entirely** — delete `shoulderCamera`, `shoulderViewOffset`, `updateShoulderCamera()`, `ThirdPersonView` type, shoulder branches in all switch statements, `playerControls` (yaw/pitch) object, shoulder mouse handling
3. **Demote freeview** — keep `freeViewCamera` + `OrbitControls` internally, remove from public `CameraMode`, add `enableDebugFreeview()`/`disableDebugFreeview()` methods
4. **Update dependent systems:**
   - ConsoleCommands.ts — update `switchCamera()` to accept `'thirdperson'`/`'freeview'` (debug)
   - ParameterManager.ts — remove shoulder/overhead parameter definitions
   - ParameterIntegration.ts — remove shoulder/overhead handlers and `updateViewParameters()`
   - DebugGUIManager.ts — update camera mode list
   - main.ts — guard `zoomToSelection()` behind debug check, clean up OrbitControls import
   - PlayerController.ts — remove shoulder branch in `updatePlayerCameraFromGamepad()`
5. **Simplify pointer lock** — only for thirdperson mode

---

## Phase 2: Battle Camera Infrastructure

6. **Define `BattleShotType`** — `'establishing' | 'playerCloseUp' | 'enemyCloseUp' | 'attackAction' | 'overShoulder'`
7. **Create `BattleCameraController`** — internal class managing the battle camera with:
   - A **shot queue** of `{ type, duration, easing, onComplete? }` entries
   - `playSequence(shots[])` to chain cinematic shots
   - `cutTo(shot)` for instant cuts
   - Per-frame interpolation of position/lookAt/FOV
   - Tracks `battlePlayerPos` and `battleEnemyPos` (8 units apart)
8. **Implement 8-unit standard distance** — update `BattleSystem.stageBattlePositions()` to place combatants exactly 8 units apart
9. **White flash transition** — new `whiteFlashTransition()` method (same pattern as `fadeTransition()` but `#fff` background). Used for battle enter/exit. Dialogue keeps black fade.
10. **Opening cinematic track** (3 seconds):
    - **0–1.5s**: Camera in front of player at low angle, hero framing
    - **1.5–3.0s**: Camera pivots 180° around player, ending behind looking at enemy
    - Lands on establishing shot as default battle view

---

## Phase 3: Battle Camera Shots & Attack Sequences

11. **Implement 5 shot types** with computed positions relative to combatant positions:

    | Shot | Position | LookAt | FOV | Usage |
    |------|----------|--------|-----|-------|
    | **Establishing** | Side, ~10u back from midpoint, 3u up | Midpoint | 46° | Default battle view |
    | **Player Close-Up** | 2.5u front of player, 1.5u up | Player chest | 40° | Player turn start |
    | **Enemy Close-Up** | 2.5u front of enemy, 1.5u up | Enemy chest | 40° | Enemy attack |
    | **Attack Action** | Side angle tracking strike | Impact point | 50° | During player attack |
    | **Over-the-Shoulder** | 1.5u behind + 0.8u side of player, 1.8u up | Enemy | 55° | Player choosing action |

12. **Attack sequence choreography** (when player selects Attack):
    - a. Cut → **Player Close-Up** (0.3s hold)
    - b. Instant teleport player to 0.8u from enemy
    - c. Cut → **Attack Action** cam (side angle)
    - d. Play attack animation (0.5s)
    - e. Instant teleport player back to battle position (8u)
    - f. Cut → **Enemy Close-Up** (0.5s damage reaction)
    - g. Return to **Establishing** or **Over-the-Shoulder**

13. **Enemy turn camera choreography**:
    - Cut → **Enemy Close-Up** → **Establishing** (attack) → **Player Close-Up** (reaction) → **Over-the-Shoulder** (next turn)

14. **Wire BattleSystem** — `performAttackTurn()` and `resolveEnemyTurn()` call camera controller sequences with callbacks for phase advancement

---

## Relevant Files

**Must modify:**
- `src/systems/CameraManager.ts` — Primary refactor: remove shoulder, demote freeview, new battle camera system
- `src/systems/BattleSystem.ts` — 8-unit staging, attack teleport choreography, camera sequence hooks
- `src/systems/PlayerController.ts` — Remove shoulder gamepad branch
- `src/systems/ConsoleCommands.ts` — Update camera mode options
- `src/systems/ParameterManager.ts` — Remove shoulder/overhead params
- `src/systems/ParameterIntegration.ts` — Remove shoulder/overhead handlers
- `src/systems/DebugGUIManager.ts` — Update mode list
- `src/main.ts` — Camera setup cleanup

---

## Verification

1. `npx tsc --noEmit` passes after each phase
2. Thirdperson: move + orbit + pointer lock + collision all work
3. Dialogue: black fade → NPC frontal shot → fade back (unchanged behavior)
4. Battle entry: white flash → 3s opening cinematic (front → pivot → enemy reveal) → establishing shot
5. Battle attack: close-up → teleport → action cam → strike → teleport back → reaction → establishing
6. Battle exit: white flash → thirdperson restored
7. Debug freeview: `switchCamera('freeview')` from console enables orbital + zoom-to-selection
8. No runtime references to 'shoulder' remain

---

## Decisions

- **8 units** standard battle distance
- **3 seconds** opening cinematic (1.5s front → 1.5s pivot)
- **Instant teleport** for attacks (classic FF style)
- **5 shot types**: establishing, player close-up, enemy close-up, attack action, over-the-shoulder
- **Freeview**: debug-only (kept internally, removed from public API)
- **Shoulder**: removed entirely
- **White flash** for battle transitions; **black fade** for dialogue (unchanged)

---

## Further Considerations

1. **Team/party battles**: Current design is 1v1. Multi-character support can layer on top of this system later.
2. **Guard camera beat**: Recommend a brief player close-up showing defensive stance for visual feedback — implement alongside or as follow-up.
3. **Victory/defeat cinematic**: A 1s dramatic shot on the victor would add polish — recommend as a follow-up task.
