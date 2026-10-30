import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const configFile = () =>
  path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'itsgenerate', 'config.json')

// base URL tanpa garis miring di akhir; gateway berformat OpenAI melayani di bawah /v1
export function normalizeBaseUrl(raw) {
  let url
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error(`Base URL tidak valid: ${raw}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Base URL harus http atau https')
  const clean = url.href.replace(/\/+$/, '')
  return /\/v\d+[a-z0-9]*$/i.test(url.pathname.replace(/\/+$/, '')) ? clean : `${clean}/v1`
}

function readFile() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8'))
  } catch (e) {
    if (e.code === 'ENOENT') return null
    throw new Error(`Berkas ${configFile()} rusak. Jalankan: itsgenerate auth logout`)
  }
}

// variabel lingkungan didahulukan supaya CI dan agent bisa memakai kredensial tanpa berkas
export function loadAuth() {
  const stored = readFile() ?? {}
  const baseUrl = process.env.ITSGENERATE_BASE_URL || stored.baseUrl
  const apiKey = process.env.ITSGENERATE_API_KEY || stored.apiKey
  if (!baseUrl || !apiKey) return null
  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    apiKey,
    fromEnv: !!(process.env.ITSGENERATE_BASE_URL || process.env.ITSGENERATE_API_KEY),
  }
}

export const storedBaseUrl = () => readFile()?.baseUrl

// berkas hanya bisa dibaca pemiliknya, ditulis lewat berkas sementara supaya tidak pernah setengah jadi
export function saveAuth(baseUrl, apiKey) {
  const file = configFile()
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ baseUrl, apiKey }, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(tmp, file)
}

export function removeAuth() {
  try {
    fs.unlinkSync(configFile())
    return true
  } catch (e) {
    if (e.code === 'ENOENT') return false
    throw e
  }
}

export const maskKey = key => (key.length > 8 ? `****${key.slice(-4)}` : '****')
