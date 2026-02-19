"""
Rename Rigify DEF- bones to match UAL1_Standard (Unreal-style) naming convention.

HOW TO USE:
  1. Open your .blend file with the Rigify character
  2. Select the Armature object
  3. Open Blender's Text Editor (or Scripting workspace)
  4. Paste this entire script and click "Run Script"
  5. All DEF- deformation bones will be renamed to UAL equivalents
  6. Re-export your GLB — animation clips from UAL1_Standard.glb
     will now bind directly without any runtime bone remapping.

WHAT THIS DOES:
  - Renames ONLY the DEF- bones (deformation bones that get exported)
  - Leaves all ORG-, MCH-, VIS-, control, and tweak bones untouched
  - Maps twist bones (.001 suffix) to UE-style _twist_01 names
  - Bones without a UAL equivalent (DEF-pelvis.L/R, DEF-breast.L/R)
    are left as-is — the animation pack has no tracks for them anyway

AFTER RUNNING:
  - Re-export the character as GLB (make sure "Only Deformation Bones"
    or equivalent export option is enabled so only renamed bones export)
  - In the Three.js project, remove the boneRemap parameter from
    registerCharacter() in main.ts — no runtime remap needed anymore
"""

import bpy

# ── Rigify DEF-  →  UAL / UE-style bone names ──────────────────────────────
RENAME_MAP = {
    # ── Spine / Torso ──
    "DEF-spine":        "pelvis",       # hip / root deform bone
    "DEF-spine.001":    "spine_01",     # lower spine
    "DEF-spine.002":    "spine_02",     # mid spine
    "DEF-spine.003":    "spine_03",     # upper spine / chest
    "DEF-spine.004":    "neck_01",      # neck
    "DEF-spine.005":    "neck_02",      # neck tip (no UAL track — harmless)
    "DEF-spine.006":    "Head",         # head (capital H matches UAL)

    # ── Left arm ──
    "DEF-shoulder.L":       "clavicle_l",
    "DEF-upper_arm.L":      "upperarm_l",
    "DEF-upper_arm.L.001":  "upperarm_twist_01_l",   # twist bone
    "DEF-forearm.L":        "lowerarm_l",
    "DEF-forearm.L.001":    "lowerarm_twist_01_l",    # twist bone
    "DEF-hand.L":           "hand_l",

    # ── Right arm ──
    "DEF-shoulder.R":       "clavicle_r",
    "DEF-upper_arm.R":      "upperarm_r",
    "DEF-upper_arm.R.001":  "upperarm_twist_01_r",
    "DEF-forearm.R":        "lowerarm_r",
    "DEF-forearm.R.001":    "lowerarm_twist_01_r",
    "DEF-hand.R":           "hand_r",

    # ── Left leg ──
    "DEF-thigh.L":      "thigh_l",
    "DEF-thigh.L.001":  "thigh_twist_01_l",
    "DEF-shin.L":       "calf_l",
    "DEF-shin.L.001":   "calf_twist_01_l",
    "DEF-foot.L":       "foot_l",
    "DEF-toe.L":        "ball_l",

    # ── Right leg ──
    "DEF-thigh.R":      "thigh_r",
    "DEF-thigh.R.001":  "thigh_twist_01_r",
    "DEF-shin.R":       "calf_r",
    "DEF-shin.R.001":   "calf_twist_01_r",
    "DEF-foot.R":       "foot_r",
    "DEF-toe.R":        "ball_r",

    # ── Skipped (no UAL equivalent) ──
    # "DEF-pelvis.L"   — left as-is
    # "DEF-pelvis.R"   — left as-is
    # "DEF-breast.L"   — left as-is
    # "DEF-breast.R"   — left as-is
}


def rename_bones():
    obj = bpy.context.active_object

    if obj is None or obj.type != 'ARMATURE':
        print("❌ ERROR: Select an Armature object first!")
        return

    armature = obj.data
    renamed = 0
    skipped = 0
    not_found = []

    # Check for potential name collisions before renaming
    existing_names = {b.name for b in armature.bones}
    for old_name, new_name in RENAME_MAP.items():
        if new_name in existing_names and old_name in existing_names:
            # Target name already taken by a different bone — 
            # Blender would auto-suffix with .001 which we don't want.
            # This shouldn't happen with this specific mapping, but just in case:
            print(f"⚠️  WARNING: '{new_name}' already exists — "
                  f"renaming existing '{new_name}' to '_old_{new_name}' first")
            armature.bones[new_name].name = f"_old_{new_name}"

    # Perform renames
    for old_name, new_name in RENAME_MAP.items():
        bone = armature.bones.get(old_name)
        if bone:
            bone.name = new_name
            renamed += 1
            print(f"  ✅  {old_name}  →  {new_name}")
        else:
            not_found.append(old_name)
            skipped += 1

    # Summary
    print(f"\n{'='*50}")
    print(f"✅ Renamed {renamed} bones")
    if skipped > 0:
        print(f"⚠️  {skipped} bones not found (already renamed?):")
        for name in not_found:
            print(f"     - {name}")
    print(f"{'='*50}")
    print(f"\nNext steps:")
    print(f"  1. File → Export → glTF 2.0 (.glb)")
    print(f"  2. In export settings, enable 'Deformation Bones Only'")
    print(f"  3. Replace your character GLB in the project")
    print(f"  4. Remove boneRemap from registerCharacter() in main.ts")


# ── Run ──
rename_bones()
