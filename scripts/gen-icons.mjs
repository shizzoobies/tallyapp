// Rasterizes public/favicon.svg into the PNG icons the manifest and iOS need.
// Run with: npm run icons
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync } from 'node:fs'

const rounded = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8')
// Full-bleed square (no transparent corners) for maskable and Apple icons.
const square = rounded.replace('rx="112"', 'rx="0"')

function render(svg, size, out) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: size } })
  writeFileSync(new URL(`../public/${out}`, import.meta.url), r.render().asPng())
  console.log('wrote', out, `${size}x${size}`)
}

render(rounded, 192, 'icon-192.png')
render(rounded, 512, 'icon-512.png')
render(square, 512, 'icon-512-maskable.png')
render(square, 180, 'apple-touch-icon.png')
