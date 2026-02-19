"""
Re-rig a Rigify character to use the Quaternius UAL skeleton.

This replaces the Rigify armature with the skeleton from UAL1_Standard.glb
so that UAL animations play without stretching / rest-pose mismatches.

=== PREREQUISITES ===
You need the UAL1_Standard.glb file (same one in public/models/animations/quaternius/).

=== HOW TO USE ===
  1. Open your character .blend file (with the Rigify-rigged character)
  2. IMPORTANT: Undo the bone rename if you already ran rename_rigify_to_ual.py.
     The bones should still be DEF-* names. If you already renamed them,
     either undo in Blender (Ctrl+Z many times) or re-append the original
     character from a backup.
  3. Open Blender's Scripting workspace
  4. Set the UAL_GLB_PATH variable below to the path of your UAL1_Standard.glb
  5. Paste this entire script and click "Run Script"
  6. The script will:
     a) Import the UAL skeleton from the GLB
     b) Align & scale the UAL skeleton to match your character
     c) Transfer vertex weights from Rigify bones to UAL bones
     d) Parent the mesh to the UAL armature
     e) Delete the old Rigify armature
  7. Verify the mesh looks correct in pose mode
  8. Export as GLB:
     - File → Export → glTF 2.0
     - Check "Export Deformation Bones Only"
     - This ensures only UAL-named bones are in the GLB

=== IF BONES WERE ALREADY RENAMED ===
If the DEF- bones have already been renamed to UAL names,
set BONES_ALREADY_RENAMED = True below. The script will use
the UAL names to look up source bones on the old armature.
"""

import bpy
import os
import math
from mathutils import Vector, Matrix

# =====================================================================
# CONFIGURATION — Edit these paths before running
# =====================================================================

# Path to the UAL1_Standard.glb file
# Use an absolute path, or a path relative to the .blend file
UAL_GLB_PATH = "/Users/matveichenkov/Documents/JavaScript/Island_crisis_three.js/public/models/animations/quaternius/UAL1_Standard.glb"

# Set to True if you already ran rename_rigify_to_ual.py and bones are
# now named with UAL names (pelvis, spine_01, etc.) instead of DEF-* names
BONES_ALREADY_RENAMED = True

# =====================================================================
# BONE MAPPING: Rigify DEF- bones → UAL bone names
# =====================================================================
# This is the same mapping from rename_rigify_to_ual.py
RIGIFY_TO_UAL = {
    # Spine
    "DEF-spine":        "pelvis",
    "DEF-spine.001":    "spine_01",
    "DEF-spine.002":    "spine_02",
    "DEF-spine.003":    "spine_03",
    "DEF-spine.004":    "neck_01",
    "DEF-spine.006":    "Head",
    # Left arm
    "DEF-shoulder.L":       "clavicle_l",
    "DEF-upper_arm.L":      "upperarm_l",
    "DEF-upper_arm.L.001":  "upperarm_twist_01_l",
    "DEF-forearm.L":        "lowerarm_l",
    "DEF-forearm.L.001":    "lowerarm_twist_01_l",
    "DEF-hand.L":           "hand_l",
    # Right arm
    "DEF-shoulder.R":       "clavicle_r",
    "DEF-upper_arm.R":      "upperarm_r",
    "DEF-upper_arm.R.001":  "upperarm_twist_01_r",
    "DEF-forearm.R":        "lowerarm_r",
    "DEF-forearm.R.001":    "lowerarm_twist_01_r",
    "DEF-hand.R":           "hand_r",
    # Left leg
    "DEF-thigh.L":      "thigh_l",
    "DEF-thigh.L.001":  "thigh_twist_01_l",
    "DEF-shin.L":       "calf_l",
    "DEF-shin.L.001":   "calf_twist_01_l",
    "DEF-foot.L":       "foot_l",
    "DEF-toe.L":        "ball_l",
    # Right leg
    "DEF-thigh.R":      "thigh_r",
    "DEF-thigh.R.001":  "thigh_twist_01_r",
    "DEF-shin.R":       "calf_r",
    "DEF-shin.R.001":   "calf_twist_01_r",
    "DEF-foot.R":       "foot_r",
    "DEF-toe.R":        "ball_r",
}

# Reverse: UAL name → Rigify DEF- name
UAL_TO_RIGIFY = {v: k for k, v in RIGIFY_TO_UAL.items()}


def find_armature_and_mesh():
    """Find the existing armature and its child mesh(es).
    
    Strategy: iterate ALL armatures and pick the one that actually has
    meshes attached (via parenting or Armature modifier).  This avoids
    accidentally selecting a Rigify metarig or duplicate that has no
    mesh children.
    """
    armatures = [obj for obj in bpy.data.objects if obj.type == 'ARMATURE']
    
    if not armatures:
        raise RuntimeError("No armature found in the scene!")
    
    def meshes_for_armature(arm):
        """Return list of mesh objects attached to *arm*."""
        found = []
        for obj in bpy.data.objects:
            if obj.type != 'MESH':
                continue
            # Check direct parent
            if obj.parent == arm:
                found.append(obj)
                continue
            # Check Armature modifier target
            for mod in obj.modifiers:
                if mod.type == 'ARMATURE' and mod.object == arm:
                    found.append(obj)
                    break
        return found
    
    # Try each armature and pick the first one that has meshes
    best_armature = None
    best_meshes = []
    
    for arm in armatures:
        ms = meshes_for_armature(arm)
        if ms:
            # Prefer the armature with the MOST meshes (the real rig)
            if len(ms) > len(best_meshes):
                best_armature = arm
                best_meshes = ms
    
    if best_armature is None or not best_meshes:
        # Last resort: list all armatures so the user knows what's available
        arm_info = [(a.name, len(a.data.bones)) for a in armatures]
        raise RuntimeError(
            f"No armature with attached meshes found!\n"
            f"  Armatures in scene: {arm_info}\n"
            f"  Make sure your character mesh is parented to the rig armature\n"
            f"  (or has an Armature modifier pointing to it)."
        )
    
    print(f"  Selected armature: '{best_armature.name}' "
          f"({len(best_armature.data.bones)} bones, "
          f"{len(best_meshes)} mesh(es))")
    
    # Also list other armatures that were skipped, for reference
    others = [a.name for a in armatures if a != best_armature]
    if others:
        print(f"  Skipped armatures (no meshes): {others}")
    
    return best_armature, best_meshes


def import_ual_skeleton(glb_path):
    """Import the UAL GLB and return its armature."""
    # Resolve relative path
    resolved = bpy.path.abspath(glb_path)
    if not os.path.exists(resolved):
        raise FileNotFoundError(
            f"UAL GLB not found at: {resolved}\n"
            f"  (original path: {glb_path})\n"
            f"  Edit UAL_GLB_PATH at the top of the script."
        )
    
    # Remember existing objects
    before = set(bpy.data.objects)
    
    bpy.ops.import_scene.gltf(filepath=resolved)
    
    # Find newly imported objects
    after = set(bpy.data.objects)
    new_objects = after - before
    
    # Find the armature among imports
    new_armature = None
    new_meshes = []
    for obj in new_objects:
        if obj.type == 'ARMATURE':
            new_armature = obj
        elif obj.type == 'MESH':
            new_meshes.append(obj)
    
    if not new_armature:
        raise RuntimeError("No armature found in UAL GLB import!")
    
    # Delete the imported meshes — we only need the skeleton
    for mesh in new_meshes:
        bpy.data.objects.remove(mesh, do_unlink=True)
    
    print(f"✅ Imported UAL skeleton: '{new_armature.name}' "
          f"with {len(new_armature.data.bones)} bones")
    
    return new_armature


def align_ual_to_character(ual_armature, old_armature):
    """
    Scale and position the UAL skeleton to match the character's proportions.
    
    This uses the pelvis (root) and head positions to compute the needed scale.
    """
    # We need to compare bone positions in edit mode
    # First, get old armature's pelvis and head world positions
    
    pelvis_name_old = "pelvis" if BONES_ALREADY_RENAMED else "DEF-spine"
    head_name_old = "Head" if BONES_ALREADY_RENAMED else "DEF-spine.006"
    
    old_pelvis = old_armature.data.bones.get(pelvis_name_old)
    old_head = old_armature.data.bones.get(head_name_old)
    
    ual_pelvis = ual_armature.data.bones.get("pelvis")
    ual_head = ual_armature.data.bones.get("Head")
    
    if not all([old_pelvis, old_head, ual_pelvis, ual_head]):
        print("⚠️  Could not find pelvis/head bones for auto-alignment.")
        print(f"   Old armature bones: {[b.name for b in old_armature.data.bones][:10]}...")
        print(f"   UAL bones: {[b.name for b in ual_armature.data.bones][:10]}...")
        print("   Skipping auto-alignment — you may need to scale manually.")
        return
    
    # Calculate heights (pelvis to head) in each skeleton's local space
    old_height = (old_armature.matrix_world @ Vector(old_head.head_local) -
                  old_armature.matrix_world @ Vector(old_pelvis.head_local)).length
    ual_height = (ual_armature.matrix_world @ Vector(ual_head.head_local) -
                  ual_armature.matrix_world @ Vector(ual_pelvis.head_local)).length
    
    if ual_height < 0.001:
        print("⚠️  UAL skeleton height is near zero — skipping alignment")
        return
    
    scale_factor = old_height / ual_height
    print(f"📐 Height ratio: {old_height:.4f} / {ual_height:.4f} = {scale_factor:.4f}")
    
    # Scale the UAL armature
    ual_armature.scale *= scale_factor
    bpy.context.view_layer.update()
    
    # Position: align pelvis positions
    old_pelvis_world = old_armature.matrix_world @ Vector(old_pelvis.head_local)
    ual_pelvis_world = ual_armature.matrix_world @ Vector(ual_pelvis.head_local)
    offset = old_pelvis_world - ual_pelvis_world
    ual_armature.location += offset
    bpy.context.view_layer.update()
    
    # Apply transforms so the armature has identity transforms
    bpy.ops.object.select_all(action='DESELECT')
    ual_armature.select_set(True)
    bpy.context.view_layer.objects.active = ual_armature
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    
    print(f"✅ UAL skeleton aligned and transforms applied (scale factor: {scale_factor:.4f})")


def transfer_weights(meshes, old_armature, ual_armature):
    """
    Transfer vertex group weights from old bone names to UAL bone names.
    
    For each vertex group on the mesh that corresponds to a Rigify DEF- bone
    (or already-renamed UAL bone), we keep the weights but rename the group
    to match the UAL skeleton's bone names.
    """
    # Build the mapping of old vertex group names → UAL names
    if BONES_ALREADY_RENAMED:
        # Bones are already named with UAL names, vertex groups should match
        # We just need to make sure the names match the UAL armature
        ual_bone_names = {b.name for b in ual_armature.data.bones}
        for mesh in meshes:
            matched = 0
            for vg in mesh.vertex_groups:
                if vg.name in ual_bone_names:
                    matched += 1
            print(f"  Mesh '{mesh.name}': {matched}/{len(mesh.vertex_groups)} "
                  f"vertex groups match UAL bones")
    else:
        # Bones still have DEF- names — rename vertex groups to UAL names
        for mesh in meshes:
            renamed = 0
            for vg in mesh.vertex_groups:
                if vg.name in RIGIFY_TO_UAL:
                    new_name = RIGIFY_TO_UAL[vg.name]
                    vg.name = new_name
                    renamed += 1
            print(f"  Mesh '{mesh.name}': renamed {renamed} vertex groups to UAL names")


def reparent_mesh_to_ual(meshes, old_armature, ual_armature):
    """
    Re-parent the meshes to the UAL armature with Armature Deform.
    Preserves existing vertex groups / weights.
    """
    for mesh in meshes:
        # Remove old armature modifiers
        for mod in list(mesh.modifiers):
            if mod.type == 'ARMATURE':
                mesh.modifiers.remove(mod)
        
        # Un-parent (but keep transforms)
        bpy.ops.object.select_all(action='DESELECT')
        mesh.select_set(True)
        bpy.context.view_layer.objects.active = mesh
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
        
        # Parent to UAL armature
        mesh.parent = ual_armature
        mesh.matrix_parent_inverse = ual_armature.matrix_world.inverted()
        
        # Add armature modifier
        mod = mesh.modifiers.new(name='Armature', type='ARMATURE')
        mod.object = ual_armature
        mod.use_vertex_groups = True
        
        print(f"  ✅ Mesh '{mesh.name}' re-parented to UAL armature")


def cleanup_old_armature(old_armature):
    """Remove the old Rigify armature."""
    name = old_armature.name
    armature_data = old_armature.data
    bpy.data.objects.remove(old_armature, do_unlink=True)
    if armature_data and armature_data.users == 0:
        bpy.data.armatures.remove(armature_data)
    print(f"  🗑️  Removed old armature '{name}'")


def main():
    print("\n" + "=" * 60)
    print("  RE-RIG CHARACTER TO UAL SKELETON")
    print("=" * 60)
    
    # Step 1: Find existing armature and meshes
    print("\n[1/6] Finding character armature and meshes...")
    old_armature, meshes = find_armature_and_mesh()
    print(f"  Found armature: '{old_armature.name}'")
    print(f"  Found meshes: {[m.name for m in meshes]}")
    
    # Step 2: Import UAL skeleton
    print("\n[2/6] Importing UAL skeleton...")
    ual_armature = import_ual_skeleton(UAL_GLB_PATH)
    
    # Step 3: Align UAL skeleton to character proportions
    print("\n[3/6] Aligning UAL skeleton to character...")
    align_ual_to_character(ual_armature, old_armature)
    
    # Step 4: Transfer / rename vertex weights
    print("\n[4/6] Transferring vertex weights...")
    transfer_weights(meshes, old_armature, ual_armature)
    
    # Step 5: Re-parent meshes to UAL armature
    print("\n[5/6] Re-parenting meshes to UAL armature...")
    reparent_mesh_to_ual(meshes, old_armature, ual_armature)
    
    # Step 6: Clean up old armature
    print("\n[6/6] Cleaning up old armature...")
    cleanup_old_armature(old_armature)
    
    print("\n" + "=" * 60)
    print("  ✅ RE-RIGGING COMPLETE")
    print("=" * 60)
    print("""
NEXT STEPS:
  1. Switch to Pose Mode on the UAL armature and verify
     the mesh follows bone movements correctly.
  2. If proportions look off, you may need to adjust bone
     positions in Edit Mode to better fit the mesh.
  3. Export as GLB:
     - File → Export → glTF 2.0 (.glb)
     - Include: ☑ Data → Mesh, ☑ Data → Armature
     - Armature: ☑ Export Deformation Bones Only
     - Save as 'Ideal_Low_Poly_Male_01.glb'
  4. Copy to public/models/characters/ in the project
  5. Animations should now play without stretching!

⚠️  IMPORTANT: The vertex weights were kept from the original
   Rigify rig. If some body parts deform incorrectly, you may 
   need to manually paint weights in Blender for the UAL bones
   that don't have an exact Rigify equivalent (e.g. finger bones,
   extra twist bones that Rigify doesn't have).
""")


if __name__ == "__main__":
    main()
else:
    main()
