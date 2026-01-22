import * as THREE from 'three'
import type { LevelDescriptor } from '../systems/LevelBuilder'

/**
 * Utility to export scene data for Blender reference
 * Helps model around existing primitive positions and scales
 */
export class BlenderExporter {
  /**
   * Generate a Python script for Blender that creates reference cubes
   * matching your Three.js scene layout
   */
  static generateBlenderScript(levelData: LevelDescriptor): string {
    const script = `# Blender reference script
# Generated from Three.js level: ${levelData.name}
# Grid size: ${levelData.gridSize} units
# 
# Usage: 
# 1. Open Blender
# 2. Open Scripting tab
# 3. Paste this script
# 4. Run script
# 5. Model around the reference cubes

import bpy
import math

# Clear existing mesh objects
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# Create collection for references
collection = bpy.data.collections.new("ThreeJS_References")
bpy.context.scene.collection.children.link(collection)

# Reference objects from Three.js scene
objects = ${JSON.stringify(levelData.objects, null, 2)}

for obj_data in objects:
    obj_id = obj_data['id']
    obj_type = obj_data.get('geometry', 'box')
    pos = obj_data['position']
    rot = obj_data.get('rotation', [0, 0, 0])
    scale = obj_data.get('scale', [1, 1, 1])
    size = obj_data.get('size', [1, 1, 1])
    
    # Create mesh based on type
    if obj_type == 'box':
        bpy.ops.mesh.primitive_cube_add(
            size=1,
            location=(pos[0], pos[2], pos[1])  # Three.js Y-up to Blender Z-up
        )
        obj = bpy.context.active_object
        # Apply size
        if len(size) == 3:
            obj.scale = (size[0], size[2], size[1])
    
    elif obj_type == 'sphere':
        radius = size[0] if size else 1
        bpy.ops.mesh.primitive_uv_sphere_add(
            radius=radius,
            location=(pos[0], pos[2], pos[1])
        )
        obj = bpy.context.active_object
    
    elif obj_type == 'cylinder':
        radius = size[0] if size else 1
        height = size[1] if len(size) > 1 else 1
        bpy.ops.mesh.primitive_cylinder_add(
            radius=radius,
            depth=height,
            location=(pos[0], pos[2], pos[1])
        )
        obj = bpy.context.active_object
    
    elif obj_type == 'plane':
        bpy.ops.mesh.primitive_plane_add(
            size=1,
            location=(pos[0], pos[2], pos[1])
        )
        obj = bpy.context.active_object
        if len(size) >= 2:
            obj.scale = (size[0], size[1], 1)
    
    else:
        # Default to cube
        bpy.ops.mesh.primitive_cube_add(
            location=(pos[0], pos[2], pos[1])
        )
        obj = bpy.context.active_object
    
    # Apply rotation (convert from Three.js to Blender coordinate system)
    obj.rotation_euler = (rot[0], rot[2], rot[1])
    
    # Apply scale
    obj.scale = (obj.scale[0] * scale[0], obj.scale[1] * scale[2], obj.scale[2] * scale[1])
    
    # Set name
    obj.name = obj_id + "_ref"
    
    # Make it wireframe for reference
    obj.display_type = 'WIRE'
    
    # Link to collection
    collection.objects.link(obj)
    bpy.context.scene.collection.objects.unlink(obj)

print("Created {} reference objects".format(len(objects)))
print("Model your assets to match these references, then export as GLB")
`
    
    return script
  }
  
  /**
   * Download Blender script as .py file
   */
  static downloadBlenderScript(levelData: LevelDescriptor, filename: string = 'level_reference.py'): void {
    const script = this.generateBlenderScript(levelData)
    const blob = new Blob([script], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    
    URL.revokeObjectURL(url)
  }
  
  /**
   * Generate CSV of object positions for spreadsheet reference
   */
  static generateCSV(levelData: LevelDescriptor): string {
    let csv = 'ID,Type,Geometry,PosX,PosY,PosZ,RotX,RotY,RotZ,ScaleX,ScaleY,ScaleZ,SizeX,SizeY,SizeZ,Collision\n'
    
    levelData.objects.forEach(obj => {
      const pos = obj.position
      const rot = obj.rotation || [0, 0, 0]
      const scale = obj.scale || [1, 1, 1]
      const size = obj.size || []
      
      csv += `${obj.id},${obj.type},${obj.geometry || 'N/A'},`
      csv += `${pos[0]},${pos[1]},${pos[2]},`
      csv += `${rot[0]},${rot[1]},${rot[2]},`
      csv += `${scale[0]},${scale[1]},${scale[2]},`
      csv += `${size[0] || ''},${size[1] || ''},${size[2] || ''},`
      csv += `${obj.collision}\n`
    })
    
    return csv
  }
}

export default BlenderExporter
