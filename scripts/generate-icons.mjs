import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const source = resolve(root, 'PREVENTA-LOGO.png')
const bg = '#0B0F19'

mkdirSync(root, { recursive: true })

await sharp(source).resize(192, 192).png().toFile(resolve(root, 'icon-192.png'))
await sharp(source).resize(512, 512).png().toFile(resolve(root, 'icon-512.png'))

const safe = 0.78
const padded = await sharp({
  create: {
    width: 512,
    height: 512,
    channels: 3,
    background: bg,
  },
})
  .composite([
    {
      input: await sharp(source)
        .resize(Math.round(512 * safe), Math.round(512 * safe))
        .png()
        .toBuffer(),
      left: Math.round((512 - 512 * safe) / 2),
      top: Math.round((512 - 512 * safe) / 2),
    },
  ])
  .png()
  .toFile(resolve(root, 'icon-maskable-512.png'))

console.log('Generated icon-192.png, icon-512.png, icon-maskable-512.png', padded)