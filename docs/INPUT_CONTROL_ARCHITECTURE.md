# Input Control Architecture

Reference for the multi-layered input system across gameplay, dialogue,
battle, camera, and mobile UI.

This document exists to keep track of control complexity as input grows across
keyboard, mouse, gamepad, and touch.

---

## 1. Design Goal

The project has four physical input layers:

- Keyboard
- Mouse
- Gamepad
- Mobile touch

Those inputs should not talk directly to gameplay systems in inconsistent ways.
They should map into the same semantic actions:

- Move
- Look
- Talk / Confirm
- Fight / Attack
- Guard
- Item
- Escape / Cancel
- Camera mode
- Pause

The core rule is:

**physical input -> semantic action -> owning gameplay system**

That avoids one device working differently from another during dialogue,
battle, or normal navigation.

---

## 2. Ownership Model

### Navigation gameplay

- Movement owner: `PlayerController`
- Camera owner: `CameraManager`
- Proximity talk owner: `DialogueManager`
- Proximity fight owner: `BattleSystem`

### Dialogue modal state

- Choice list owner: `DialogueManager`
- Confirm / continue owner: `DialogueManager`
- Cancel / dismiss owner: `DialogueManager`

### Battle modal state

- Battle action menu owner: `BattleSystem`
- Confirm / execute owner: `BattleSystem`
- Cancel / escape owner: `BattleSystem`

### Mobile overlays

- Dialogue overlay owner: `DialogueManager`
- Battle overlay owner: `BattleSystem`
- Pause / start button owner: `main.ts`

### Gamepad routing

- Hardware polling owner: `InputSystem`
- Semantic modal routing owner: `main.ts`
- Movement / look fallback owner: `PlayerController`

---

## 3. Input Layers

### Keyboard

Navigation gameplay:

- `W/A/S/D`: movement
- `J` or `Enter`: talk / confirm / contextual action
- `K`: fight / attack
- `I`: camera mode
- `Shift`: run

Dialogue:

- `I`, `W`, `ArrowUp`: previous choice
- `K`, `S`, `ArrowDown`: next choice
- `J`, `Enter`: confirm current choice / continue
- `L`, `Escape`: cancel / close dialogue

Battle:

- `W`, `ArrowUp`: previous action
- `S`, `ArrowDown`: next action
- `J`: attack
- `K`: guard
- `I`: item
- `L`, `Escape`: escape
- `Enter`: confirm currently highlighted action

### Mouse

Navigation gameplay:

- Move mouse: camera look
- Left click: `TALK`
- Right click: `FIGHT`

Rules:

- Mouse clicks only trigger `TALK` / `FIGHT` during gameplay navigation
- Mouse clicks do not force actions during dialogue, battle, camera fade, or
  debug freeview
- If left click does not find a gameplay interaction, the existing canvas click
  logic still runs

### Gamepad

Navigation gameplay:

- Left stick / D-pad: movement
- Right stick: camera look
- `A`: confirm / talk
- `X`: fight / attack
- `R3`: camera mode
- `Start`: pause

Dialogue:

- D-pad up / left stick up edge: previous choice
- D-pad down / left stick down edge: next choice
- `A`: confirm / continue
- `B`: cancel / close

Battle:

- D-pad up / left stick up edge: previous action
- D-pad down / left stick down edge: next action
- `X`: attack
- `A`: guard
- `Y`: item
- `B`: escape

### Mobile touch

Navigation gameplay:

- Tap ground: tap-to-navigate marker
- Drag on look side: camera rotation
- Double tap + hold on navigate side: run modifier
- Prompt tap: `TALK` or `FIGHT`

Dialogue:

- Tap a dialogue choice: execute directly
- Tap continue hint: close / continue

Battle:

- Tap `Attack`, `Guard`, `Escape`, `Items`: execute directly
- No touch-only highlight step is required before execution

---

## 4. Routing Flow

### Keyboard flow

Keyboard events are split by owner:

- `PlayerController` owns navigation gameplay input
- `DialogueManager` owns active dialogue keyboard input
- `BattleSystem` owns active battle keyboard input

Important constraint:

- `PlayerController` must not remap modal keys differently from the modal
  systems, or the same key will behave differently depending on who consumes it

### Gamepad flow

Gamepad is different because hardware polling happens in `InputSystem`.

Flow:

1. `InputSystem` polls hardware and produces `GamepadPlayerInput`
2. `main.ts` checks for active modal systems
3. If dialogue or battle is active, `main.ts` sends semantic actions to the
   owning modal system first
4. If modal input was consumed, `PlayerController` receives a neutral gamepad
   input so movement or gameplay actions are not double-fired
5. If no modal owns the input, `PlayerController` receives the original input

### Touch flow

Touch is split between:

- `PlayerController` for tap-to-move and touch-look
- `DialogueManager` for dialogue overlay taps
- `BattleSystem` for battle overlay taps
- `main.ts` for pause button

### Mouse flow

Mouse gameplay actions now route through `main.ts`:

1. Left click tries `DialogueManager.handleActionButton()`
2. Right click tries `BattleSystem.handleAttackButton()`
3. Only when navigation gameplay is active
4. Freeview, dialogue, battle, and camera fade block those actions

---

## 5. Current Files

Primary files involved in input complexity:

- `src/main.ts`
- `src/systems/InputSystem.ts`
- `src/systems/PlayerController.ts`
- `src/systems/DialogueSystem.ts`
- `src/systems/BattleSystem.ts`
- `src/systems/CameraManager.ts`

Responsibilities:

- `main.ts`: global routing, active input mode, mouse gameplay clicks,
  mobile pause button
- `InputSystem.ts`: hardware polling and low-level gamepad parsing
- `PlayerController.ts`: movement, touch look, tap-to-navigate, gameplay input
- `DialogueSystem.ts`: dialogue prompt, overlay, choice navigation, confirm,
  cancel
- `BattleSystem.ts`: battle prompt, overlay, menu actions, confirm, cancel
- `CameraManager.ts`: gameplay, dialogue, battle, freeview camera states

---

## 6. Modal Safety Rules

These rules are required to prevent stuck-input bugs:

- Only one modal owner should consume confirm/cancel at a time
- Dialogue state must end when gameplay camera resumes
- Battle state must block gameplay movement while active
- Touch look deltas must be consumed once per move event to prevent sticky
  camera motion
- Gamepad modal input must be consumed before it reaches `PlayerController`
- Mouse click actions must be blocked while camera fade is active

---

## 7. Known Complexity Pressure Points

These are the areas most likely to regress as the project grows:

- `PlayerController` still owns both movement and some contextual gameplay
  actions, which makes it easy to accidentally duplicate modal behavior
- `main.ts` currently acts as the cross-device router for gamepad and mouse
  modal behavior
- Touch input has both world interaction and overlay interaction paths
- Camera state and modal state can drift apart unless explicitly reconciled

---

## 8. Recommended Future Refactor

The current system works, but long-term the clean architecture is:

### Central semantic input bus

Create a single action enum such as:

```ts
type InputAction =
  | 'move'
  | 'look'
  | 'confirm'
  | 'cancel'
  | 'talk'
  | 'fight'
  | 'attack'
  | 'guard'
  | 'item'
  | 'cameraMode'
  | 'pause'
```

Then route all devices into that single bus.

### Modal stack

Instead of each system checking whether it is active, use a modal priority
stack:

- Top modal gets first chance to consume input
- If unconsumed, input falls through to gameplay

Example modal priority:

1. Pause
2. Battle
3. Dialogue
4. Gameplay

That would remove most of the current cross-checking between systems.

---

## 9. Regression Checklist

Whenever input changes, verify all of these:

- Keyboard `J/K/I/L` works in navigation, dialogue, and battle
- Gamepad `A/B/X/Y` and D-pad work in dialogue and battle
- Touch drag camera does not stick or drift
- Touch battle actions execute on tap, not highlight-only
- Left click talks during navigation gameplay
- Right click fights during navigation gameplay
- Dialogue closes when gameplay camera resumes
- Movement is blocked during dialogue and battle

---

## 10. Related Docs

- `INSTRUCTIONS.md` for overall controls and architecture
- `docs/SCALING_ARCHITECTURE.md` for system growth and performance constraints