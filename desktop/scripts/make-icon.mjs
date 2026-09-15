/**
 * Renders the app icon without any image tooling: the brand's gold dot with a
 * small candlestick motif on the dark background.
 *
 *   node scripts/make-icon.mjs
 *
 * Writes assets/icon.png (512 px) and assets/icon.ico (16-256 px, PNG-encoded
 * entries) used by the exe and the setup file. Run again only after changing
 * the design.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const assets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets')

const BG = [14, 17, 23]
const PANEL = [27, 33, 44]
const GOLD = [224, 182, 74]
const UP = [38, 166, 154]
const DOWN = [239, 83, 80]

/** Draw the icon at `size` px. The design is authored on a 512 px grid. */
function render(size) {
  const k = size / 512
  const pixels = new Uint8Array(size * size * 4)

  const plot = (x, y, color, a) => {
    if (a <= 0) return
    const i = (y * size + x) * 4
    const inv = 1 - a
    pixels[i] = pixels[i] * inv + color[0] * a
    pixels[i + 1] = pixels[i + 1] * inv + color[1] * a
    pixels[i + 2] = pixels[i + 2] * inv + color[2] * a
    pixels[i + 3] = Math.max(pixels[i + 3], a * 255)
  }

  // Anti-aliased shape from a signed distance function in design units.
  const fill = (sdf, color) => {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const d = sdf((x + 0.5) / k, (y + 0.5) / k) * k
        plot(x, y, color, Math.min(1, Math.max(0, 0.5 - d)))
      }
    }
  }

  const roundRect = (cx, cy, hw, hh, r) => (x, y) => {
    const qx = Math.abs(x - cx) - hw + r
    const qy = Math.abs(y - cy) - hh + r
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
  }
  const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r

  fill(roundRect(256, 256, 240, 240, 96), BG)
  fill(roundRect(256, 256, 206, 206, 72), PANEL)

  const candle = (cx, top, bottom, bodyTop, bodyBottom, color) => {
    fill(roundRect(cx, (top + bottom) / 2, 5, (bottom - top) / 2, 5), color)
    fill(roundRect(cx, (bodyTop + bodyBottom) / 2, 26, (bodyBottom - bodyTop) / 2, 8), color)
  }
  candle(166, 170, 380, 220, 330, DOWN)
  candle(256, 130, 350, 170, 290, UP)
  candle(346, 110, 300, 140, 240, UP)

  for (let r = 70; r > 38; r -= 4) fill(circle(372, 140, r), GOLD.map((c, i) => c * 0.12 + PANEL[i] * 0.88))
  fill(circle(372, 140, 38), GOLD)

  return encodePng(size, pixels)
}

// --- PNG ----------------------------------------------------------------------
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let j = 0; j < 8; j += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA

  const row = size * 4 + 1
  const raw = Buffer.alloc(size * row)
  for (let y = 0; y < size; y += 1) {
    raw[y * row] = 0 // filter: none
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * row + 1)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --- ICO: directory of PNG-encoded images (supported since Windows Vista) -------
function encodeIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)

  let offset = 6 + 16 * images.length
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size // 0 means 256
    entry[1] = size >= 256 ? 0 : size
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    return entry
  })

  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)])
}

mkdirSync(assets, { recursive: true })
writeFileSync(path.join(assets, 'icon.png'), render(512))
writeFileSync(
  path.join(assets, 'icon.ico'),
  encodeIco([256, 64, 48, 32, 16].map((size) => ({ size, png: render(size) }))),
)
console.log(`Wrote ${path.join(assets, 'icon.png')} and icon.ico`)
