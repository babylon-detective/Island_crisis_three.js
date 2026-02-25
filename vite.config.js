import { defineConfig } from 'vite'
import topLevelAwait from 'vite-plugin-top-level-await'
import glsl from 'vite-plugin-glsl'
import { readdirSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'

function removeBlendFilesFromDist(distDir = 'dist') {
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry)
      const stats = statSync(fullPath)

      if (stats.isDirectory()) {
        walk(fullPath)
        continue
      }

      if (fullPath.endsWith('.blend') || fullPath.endsWith('.blend1')) {
        rmSync(fullPath)
      }
    }
  }

  try {
    walk(distDir)
  } catch {
    // Dist may not exist yet in some command flows.
  }
}

export default defineConfig({
  plugins: [
    topLevelAwait(),
    glsl({
      include: ['**/*.glsl', '**/*.wgsl', '**/*.vert', '**/*.frag'],
      exclude: 'node_modules/**',
      warnDuplicatedImports: true,
      defaultExtension: 'glsl',
      compress: false,
      watch: true
    }),
    {
      name: 'exclude-blend-from-build-output',
      apply: 'build',
      closeBundle() {
        removeBlendFilesFromDist('dist')
      }
    }
  ],
  base: './',
})