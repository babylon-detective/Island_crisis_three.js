// Quick script to inspect animation clips inside a GLB file
// Usage: node inspect-glb.mjs <path-to-glb>

import { readFileSync } from 'fs'
import { Blob } from 'buffer'

// Minimal GLB parser — doesn't need Three.js, just reads the JSON chunk
const filePath = process.argv[2] || 'public/models/animations/quaternius/UAL1_Standard.glb'
const buf = readFileSync(filePath)

// GLB header: magic(4) version(4) length(4)
const magic = buf.readUInt32LE(0)
if (magic !== 0x46546C67) { // 'glTF'
  console.error('Not a valid GLB file')
  process.exit(1)
}

const version = buf.readUInt32LE(4)
const totalLength = buf.readUInt32LE(8)
console.log(`GLB version: ${version}, total size: ${(totalLength / 1024 / 1024).toFixed(2)} MB`)

// First chunk should be JSON
const chunk0Length = buf.readUInt32LE(12)
const chunk0Type = buf.readUInt32LE(16)

if (chunk0Type !== 0x4E4F534A) { // 'JSON'
  console.error('First chunk is not JSON')
  process.exit(1)
}

const jsonStr = buf.toString('utf8', 20, 20 + chunk0Length)
const gltf = JSON.parse(jsonStr)

// Print animation info
const animations = gltf.animations || []
console.log(`\nFound ${animations.length} animation(s):\n`)

animations.forEach((anim, i) => {
  const channels = anim.channels || []
  const samplers = anim.samplers || []
  
  // Calculate approximate duration from samplers
  let maxTime = 0
  for (const sampler of samplers) {
    const accessor = gltf.accessors[sampler.input]
    if (accessor && accessor.max) {
      maxTime = Math.max(maxTime, accessor.max[0])
    }
  }
  
  console.log(`  [${i}] "${anim.name || '(unnamed)'}"`)
  console.log(`      Channels: ${channels.length}, Samplers: ${samplers.length}, Duration: ~${maxTime.toFixed(2)}s`)
  
  // Show target nodes
  const targetNodes = new Set()
  for (const ch of channels) {
    const nodeIdx = ch.target?.node
    if (nodeIdx !== undefined) {
      const nodeName = gltf.nodes[nodeIdx]?.name || `node_${nodeIdx}`
      targetNodes.add(nodeName)
    }
  }
  if (targetNodes.size <= 10) {
    console.log(`      Target bones: ${[...targetNodes].join(', ')}`)
  } else {
    console.log(`      Target bones: ${targetNodes.size} unique nodes`)
  }
  console.log()
})

// Print skeleton info
const skins = gltf.skins || []
console.log(`\nSkins (skeletons): ${skins.length}`)
skins.forEach((skin, i) => {
  const joints = skin.joints || []
  const jointNames = joints.slice(0, 10).map(j => gltf.nodes[j]?.name || `node_${j}`)
  console.log(`  [${i}] "${skin.name || '(unnamed)'}" — ${joints.length} joints`)
  console.log(`      First joints: ${jointNames.join(', ')}${joints.length > 10 ? '...' : ''}`)
})

// Print mesh info
const meshes = gltf.meshes || []
console.log(`\nMeshes: ${meshes.length}`)
meshes.forEach((mesh, i) => {
  console.log(`  [${i}] "${mesh.name || '(unnamed)'}" — ${mesh.primitives?.length || 0} primitive(s)`)
})

// Print scene hierarchy (top-level)
const scenes = gltf.scenes || []
if (scenes.length > 0) {
  const rootNodes = scenes[0].nodes || []
  console.log(`\nScene root nodes: ${rootNodes.length}`)
  rootNodes.forEach(ni => {
    const node = gltf.nodes[ni]
    console.log(`  "${node?.name || `node_${ni}`}"${node?.children ? ` (${node.children.length} children)` : ''}${node?.mesh !== undefined ? ' [has mesh]' : ''}${node?.skin !== undefined ? ' [has skin]' : ''}`)
  })
}
