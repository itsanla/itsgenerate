import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const encode = (img, out, quality) => {
  const ext = path.extname(out).toLowerCase()
  if (ext === '.webp') return img.webp({ quality, effort: 6 })
  if (ext === '.png') return img.png()
  throw new Error('Gaya ilustrasi dan logo butuh keluaran .webp atau .png (latar transparan)')
}

// Latar = putih yang tersambung ke tepi gambar, jadi putih di dalam bentuk tetap utuh.
// Tepi antialias dibuat semi transparan dan campuran putihnya dilepas supaya tidak berbingkai putih di latar gelap.
export function removeWhite(data, w, h, logo) {
  const threshold = logo ? 236 : 238
  const low = logo ? 170 : 160
  const radius = logo ? 3 : 2
  const n = w * h
  const min = new Uint8Array(n)
  for (let i = 0; i < n; i++) min[i] = Math.min(data[i * 3], data[i * 3 + 1], data[i * 3 + 2])

  const bg = new Uint8Array(n)
  const stack = new Int32Array(n)
  let top = 0
  const seed = i => {
    if (min[i] >= threshold && !bg[i]) {
      bg[i] = 1
      stack[top++] = i
    }
  }
  for (let x = 0; x < w; x++) {
    seed(x)
    seed((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    seed(y * w)
    seed(y * w + w - 1)
  }
  while (top) {
    const i = stack[--top]
    const x = i % w
    if (x > 0) seed(i - 1)
    if (x < w - 1) seed(i + 1)
    if (i >= w) seed(i - w)
    if (i < n - w) seed(i + w)
  }

  const nearBg = (x, y) => {
    for (let dy = Math.max(0, y - radius); dy <= Math.min(h - 1, y + radius); dy++) {
      for (let dx = Math.max(0, x - radius); dx <= Math.min(w - 1, x + radius); dx++) {
        if (bg[dy * w + dx]) return true
      }
    }
    return false
  }

  const rgba = Buffer.alloc(n * 4)
  let left = w, right = -1, upper = h, lower = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (bg[i]) continue
      let alpha = 1
      const edge = nearBg(x, y)
      if (edge) alpha = 1 - Math.min(1, Math.max(0, (min[i] - low) / (255 - low)))
      const a = Math.max(alpha, 1e-3)
      for (let c = 0; c < 3; c++) {
        const v = data[i * 3 + c]
        rgba[i * 4 + c] = edge ? Math.min(255, Math.max(0, (v - 255 * (1 - a)) / a)) : v
      }
      const a8 = Math.round(alpha * 255)
      rgba[i * 4 + 3] = a8
      if (a8 > 10) {
        if (x < left) left = x
        if (x > right) right = x
        if (y < upper) upper = y
        if (y > lower) lower = y
      }
    }
  }
  if (right < 0) throw new Error('Gambar kosong: seluruhnya putih. Ulangi atau ganti subjek')
  return { rgba, box: { left, top: upper, width: right - left + 1, height: lower - upper + 1 } }
}

export async function saveStyled(buffer, style, out) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  if (style === 'bebas') {
    await sharp(buffer).toFile(out)
    return
  }
  const logo = style === 'logo'
  const { data, info } = await sharp(buffer).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { rgba, box } = removeWhite(data, info.width, info.height, logo)
  const cropped = await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract(box).raw().toBuffer()
  const raw = { raw: { width: box.width, height: box.height, channels: 4 } }
  const clear = { r: 0, g: 0, b: 0, alpha: 0 }
  if (logo) {
    const side = Math.floor(Math.max(box.width, box.height) / 0.86)
    const padX = side - box.width, padY = side - box.height
    const square = await sharp(cropped, raw)
      .extend({ left: padX >> 1, right: padX - (padX >> 1), top: padY >> 1, bottom: padY - (padY >> 1), background: clear })
      .raw().toBuffer()
    await encode(sharp(square, { raw: { width: side, height: side, channels: 4 } }).resize(256, 256), out, 92).toFile(out)
    return
  }
  const margin = Math.floor(Math.max(box.width, box.height) * 0.04)
  const framed = await sharp(cropped, raw).extend({ left: margin, right: margin, top: margin, bottom: margin, background: clear }).raw().toBuffer()
  const size = { raw: { width: box.width + 2 * margin, height: box.height + 2 * margin, channels: 4 } }
  await encode(sharp(framed, size).resize(720, 720, { fit: 'inside', withoutEnlargement: true }), out, 88).toFile(out)
}

// Satu lembar tinjau di atas latar krem, supaya agent atau manusia bisa memilih kandidat sekaligus
export async function contactSheet(files, out, columns = Math.min(files.length, 3), cell = 360) {
  const rows = Math.ceil(files.length / columns)
  const parts = await Promise.all(files.map(async (f, i) => {
    const input = await sharp(f).resize(cell - 20, cell - 20, { fit: 'inside' }).png().toBuffer()
    const m = await sharp(input).metadata()
    return {
      input,
      left: (i % columns) * cell + ((cell - m.width) >> 1),
      top: Math.floor(i / columns) * cell + ((cell - m.height) >> 1),
    }
  }))
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  await sharp({ create: { width: cell * columns, height: cell * rows, channels: 3, background: '#fbf6ec' } })
    .composite(parts).png().toFile(out)
}
