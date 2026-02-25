# Quaternius Universal Animation Library (UAL)

Animation clips for the Island Crisis character pipeline. This directory holds
GLB files from the [Quaternius Universal Animation Library](https://quaternius.com/packs/ultimateanimatedcharacter.html).

## Setup

1. Download the free animation pack from https://quaternius.com/packs/ultimateanimatedcharacter.html
2. Place `UAL1_Standard.glb` (packed, ~7.7 MB, 45 clips) in this directory
3. Restart the dev server — clips load automatically via `config/animation-sets.json`
4. Press **`` ` ``** (backtick) in-game to open the **Animation Browser**

## Blender → Three.js Animation Workflow

```
Quaternius UAL Pack
  └─ UAL1_Standard.glb (45 clips, 65-joint UE skeleton)
       │
       ▼
  CharacterAnimationSystem
       ├─ GLTFLoader extracts animation clips
       ├─ Maps internal clip names → friendly names (animation-sets.json)
       ├─ Binds to character's AnimationMixer
       └─ AnimationStateMachine drives transitions
            └─ 14 states, priority-based rules
```

**Character skeleton requirement:** The character model must use UAL bone
naming (65 joints: `pelvis`, `spine_01`, `upperarm_l`, etc.). Use
`scripts/rerig_to_ual_skeleton.py` in Blender to re-rig a Rigify character,
or `scripts/rename_rigify_to_ual.py` to rename DEF- bones.

If the character keeps Rigify naming, pass `buildQuaterniusToRigifyRemap()` at
registration time for runtime bone remapping.

## Packed Format (Recommended)

The default configuration expects a **packed GLB** — a single file containing
all animation clips:

**`UAL1_Standard.glb`** (~7.7 MB, 45 clips, 65-joint UE-style skeleton)

The system loads this once and extracts individual clips by their internal name.

### Full Clip Inventory (45 clips)

| Source Clip (in GLB) | Friendly Name | Loop | Category |
|---|---|---|---|
| `Idle_Loop` | idle | Yes | Locomotion |
| `Walk_Loop` | walk | Yes | Locomotion |
| `Jog_Fwd_Loop` | run | Yes | Locomotion |
| `Sprint_Loop` | sprint | Yes | Locomotion |
| `Walk_Formal_Loop` | walk_formal | Yes | Locomotion |
| `Crouch_Idle_Loop` | crouch_idle | Yes | Locomotion |
| `Crouch_Fwd_Loop` | crouch_walk | Yes | Locomotion |
| `Jump_Start` | jump | No | Jumping |
| `Jump_Loop` | fall | Yes | Jumping |
| `Jump_Land` | land | No | Jumping |
| `Punch_Jab` | attack | No | Combat |
| `Punch_Cross` | attack_cross | No | Combat |
| `Sword_Attack` | sword_attack | No | Combat |
| `Sword_Attack_RM` | sword_attack_rm | No | Combat |
| `Sword_Idle` | sword_idle | Yes | Combat |
| `Hit_Chest` | hit | No | Combat |
| `Hit_Head` | hit_head | No | Combat |
| `Death01` | death | No | Combat |
| `Roll` | roll | No | Combat |
| `Roll_RM` | roll_rm | No | Combat |
| `Pistol_Idle_Loop` | pistol_idle | Yes | Pistol |
| `Pistol_Shoot` | pistol_shoot | No | Pistol |
| `Pistol_Reload` | pistol_reload | No | Pistol |
| `Pistol_Aim_Neutral` | pistol_aim | No | Pistol |
| `Pistol_Aim_Up` | pistol_aim_up | No | Pistol |
| `Pistol_Aim_Down` | pistol_aim_down | No | Pistol |
| `Spell_Simple_Enter` | spell_enter | No | Spell |
| `Spell_Simple_Idle_Loop` | spell_idle | Yes | Spell |
| `Spell_Simple_Shoot` | spell_shoot | No | Spell |
| `Spell_Simple_Exit` | spell_exit | No | Spell |
| `Interact` | interact | No | Interaction |
| `PickUp_Table` | pick_up | No | Interaction |
| `Push_Loop` | push | Yes | Interaction |
| `Fixing_Kneeling` | fixing | No | Interaction |
| `Driving_Loop` | driving | Yes | Interaction |
| `Idle_Talking_Loop` | talking | Yes | Social |
| `Dance_Loop` | dance | Yes | Social |
| `Idle_Torch_Loop` | torch_idle | Yes | Social |
| `Sitting_Enter` | sit_enter | No | Sitting |
| `Sitting_Idle_Loop` | sit_idle | Yes | Sitting |
| `Sitting_Talking_Loop` | sit_talking | Yes | Sitting |
| `Sitting_Exit` | sit_exit | No | Sitting |
| `Swim_Fwd_Loop` | swim | Yes | Swimming |
| `Swim_Idle_Loop` | swim_idle | Yes | Swimming |
| `A_TPose` | tpose | No | Reference |

### Currently Registered (22 clips used by state machine)

`idle`, `walk`, `run`, `run_backward`, `walk_backward`, `strafe_left`,
`strafe_right`, `jump`, `fall`, `land`, `attack`, `attack_kick`, `block`,
`hit`, `death`, `wave`, `pick_up`, `interact`, `dance`, `sit`, `crouch_idle`,
`crouch_walk`

Configured in `config/animation-sets.json`.

## Split Format (Alternative)

If you have individual GLB files (one clip per file), switch to
`registry.registerQuaterniusSet()` in `main.ts`. Expected filenames:
`Idle.glb`, `Walk.glb`, `Run_Forward.glb`, `Jump.glb`, etc.

## Skeleton & Retargeting

The UAL uses a **UE-style skeleton** (65 joints: `root`, `pelvis`, `spine_01`,
`upperarm_l`, `thigh_r`, etc.).

### Zero-Remap Export (Recommended)

Re-rig your character in Blender using `scripts/rerig_to_ual_skeleton.py`:

1. Open your character `.blend` file
2. Set `UAL_GLB_PATH` in the script to point to `UAL1_Standard.glb`
3. Run the script — it replaces the Rigify armature with the UAL skeleton
4. Export as GLB — bone names match exactly, no runtime remapping needed

### Runtime Remapping (Alternative)

If keeping Rigify naming, use `buildQuaterniusToRigifyRemap()`:

```ts
await charAnimSystem.registerCharacter({
  id: 'player',
  model: playerModel,
  animationSetId: 'quaternius-universal',
  boneRemap: buildQuaterniusToRigifyRemap(),
})
```

See `INSTRUCTIONS.md` for the full bone mapping table.

## Testing

Press **`` ` ``** (backtick) in-game to open the **Animation Browser** and
scroll through all loaded clips to verify retargeting quality.

## Notes

- Missing clips are handled gracefully — the system logs warnings and continues.
- The packed file format is more efficient (one HTTP request vs. 45).
- Clips are cached globally — multiple characters sharing the same set don't
  re-download the GLB.
- Walk/run speeds are tuned to 1.4 / 5.0 m/s to match UAL animation cycles.
