import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { Worker } from 'node:worker_threads'
import sharp from 'sharp'
import { normalizeBaseUrl } from '../src/config.js'
import { contactSheet, saveStyled } from '../src/process.js'

const BIN = new URL('../bin/itsgenerate.js', import.meta.url).pathname
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'itsgenerate-'))
const run = (args, opts = {}) => {
  const env = { ...process.env, ITSGENERATE_BASE_URL: '', ITSGENERATE_API_KEY: '', ...opts.env }
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', input: opts.input ?? '', env })
}

// PNG 200x200: latar putih, kotak biru di tengah, titik putih di dalam kotak
async function samplePng() {
  const w = 200, data = Buffer.alloc(w * w * 3, 255)
  for (let y = 50; y < 150; y++) {
    for (let x = 50; x < 150; x++) {
      const inner = x > 95 && x < 105 && y > 95 && y < 105
      if (!inner) data.set([30, 60, 200], (y * w + x) * 3)
    }
  }
  return sharp(data, { raw: { width: w, height: w, channels: 3 } }).png().toBuffer()
}

// Gateway palsu di thread sendiri, karena spawnSync memblokir thread utama
function fakeGateway(pngBase64) {
  const src = `
    const http = require('node:http'); const { parentPort, workerData } = require('node:worker_threads')
    const s = http.createServer((req, res) => {
      const j = (c, b) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)) }
      if (req.headers.authorization !== 'Bearer kunci-benar-1234') return j(401, { error: 'no' })
      if (req.url === '/v1/models') return j(200, { data: [{ id: 'a' }, { id: 'b' }] })
      let body = ''; req.on('data', c => body += c); req.on('end', () => {
        if (req.url === '/v1/chat/completions') return j(200, { choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,' + workerData } }] } }] })
        if (req.url === '/v1/images/generations') return j(200, { data: [{ b64_json: workerData }] })
        j(404, {})
      })
    })
    s.listen(0, '127.0.0.1', () => parentPort.postMessage(s.address().port))`
  const worker = new Worker(src, { eval: true, workerData: pngBase64 })
  return new Promise(resolve => worker.once('message', port => resolve({ url: `http://127.0.0.1:${port}`, stop: () => worker.terminate() })))
}

test('normalizeBaseUrl menambah /v1 dan membuang garis miring', () => {
  assert.equal(normalizeBaseUrl('https://a.id/'), 'https://a.id/v1')
  assert.equal(normalizeBaseUrl('https://a.id/v1/'), 'https://a.id/v1')
  assert.equal(normalizeBaseUrl('https://a.id/openai/v2'), 'https://a.id/openai/v2')
  assert.throws(() => normalizeBaseUrl('bukan url'))
})

test('--help dan --version tidak butuh login', () => {
  const h = run(['--help'])
  assert.equal(h.status, 0)
  for (const word of ['image', 'auth login', 'auth status', 'auth logout']) assert.match(h.stdout, new RegExp(word))
  assert.match(run(['--version']).stdout, /^\d+\.\d+\.\d+/)
  assert.equal(run(['bukan-perintah']).status, 2)
})

test('alur auth: status, login ditolak, login, berkas 600, logout', async () => {
  const gw = await fakeGateway('')
  const env = { XDG_CONFIG_HOME: tmp() }
  const file = path.join(env.XDG_CONFIG_HOME, 'itsgenerate/config.json')
  try {
    assert.equal(run(['auth', 'status'], { env }).status, 3)
    const bad = run(['auth', 'login'], { env, input: `${gw.url}\nkunci-salah\n` })
    assert.equal(bad.status, 3)
    assert.equal(fs.existsSync(file), false, 'key ditolak tidak boleh tersimpan')
    assert.equal(run(['auth', 'login'], { env, input: `${gw.url}\nkunci-benar-1234\n` }).status, 0)
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    const st = run(['auth', 'status'], { env })
    assert.equal(st.status, 0)
    assert.match(st.stdout, /2 model/)
    assert.match(st.stdout, /\*\*\*\*1234/)
    assert.doesNotMatch(st.stdout + st.stderr, /kunci-benar-1234/)
    assert.equal(run(['auth', 'logout'], { env }).status, 0)
    assert.equal(fs.existsSync(file), false)
  } finally {
    await gw.stop()
  }
})

test('image: kandidat dan lembar, stdout hanya path', async () => {
  const gw = await fakeGateway((await samplePng()).toString('base64'))
  const dir = tmp()
  const env = { ITSGENERATE_BASE_URL: gw.url, ITSGENERATE_API_KEY: 'kunci-benar-1234' }
  try {
    const out = path.join(dir, 'a.webp'), sheet = path.join(dir, 's.png')
    const r = run(['image', '-k', '2', '--lembar', sheet, '-o', out, 'kotak biru'], { env })
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(r.stdout.trim().split('\n'), [path.join(dir, 'a-1.webp'), path.join(dir, 'a-2.webp'), sheet])
    const viaImages = path.join(dir, 'b.png')
    assert.equal(run(['image', '-m', 'gpt-image-2', '-g', 'bebas', '-o', viaImages, 'x'], { env }).status, 0)
    assert.equal((await sharp(viaImages).metadata()).width, 200)
    assert.equal(run(['image', 'x'], { env: { ...env, ITSGENERATE_API_KEY: 'salah-salah-salah' } }).status, 3)
    assert.equal(run(['image'], { env }).status, 2)
    assert.equal(run(['image', '-g', 'aneh', 'x'], { env }).status, 2)
  } finally {
    await gw.stop()
  }
})

test('ilustrasi: latar transparan, putih di dalam bentuk tetap', async () => {
  const dir = tmp(), out = path.join(dir, 'x.png')
  await saveStyled(await samplePng(), 'ilustrasi', out)
  const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const at = (x, y) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)]
  assert.equal(at(0, 0)[3], 0, 'sudut harus transparan')
  const c = at(info.width >> 1, info.height >> 1)
  assert.deepEqual(c, [255, 255, 255, 255], 'putih di tengah bentuk tidak ikut terhapus')
})

test('logo: 256 x 256 dan lembar tinjau', async () => {
  const dir = tmp(), out = path.join(dir, 'l.webp'), sheet = path.join(dir, 's.png')
  await saveStyled(await samplePng(), 'logo', out)
  const m = await sharp(out).metadata()
  assert.deepEqual([m.width, m.height, m.hasAlpha], [256, 256, true])
  await contactSheet([out, out], sheet)
  assert.equal((await sharp(sheet).metadata()).width, 720)
})

test('gambar seluruhnya putih ditolak', async () => {
  const white = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } }).png().toBuffer()
  await assert.rejects(saveStyled(white, 'ilustrasi', path.join(tmp(), 'x.webp')), /kosong/)
})
