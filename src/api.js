const TIMEOUT_MS = 240_000
const RETRY_WAIT_MS = 30_000
const RETRIES = 2

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
    this.exitCode = status === 401 || status === 403 ? 3 : 1
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const headers = apiKey => ({ authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' })

function explain(status) {
  if (status === 401 || status === 403) return 'ditolak: API key salah, kuota habis, atau model ini tidak diizinkan untuk key ini'
  if (status === 429) return 'terlalu banyak permintaan: batas gateway tercapai, coba lagi nanti'
  if (status === 404) return 'endpoint atau model tidak ditemukan: periksa base URL dan nama model'
  return 'gateway mengembalikan galat'
}

async function post(auth, path, body, onWait) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(auth.baseUrl + path, {
      method: 'POST',
      headers: headers(auth.apiKey),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.ok) return res.json()
    if (res.status === 429 && attempt < RETRIES) {
      onWait?.(RETRY_WAIT_MS)
      await sleep(RETRY_WAIT_MS)
      continue
    }
    throw new ApiError(`HTTP ${res.status}, ${explain(res.status)}`, res.status)
  }
}

function fromDataUri(uri) {
  const comma = uri.indexOf(',')
  if (!uri.startsWith('data:') || comma < 0) return null
  return Buffer.from(uri.slice(comma + 1), 'base64')
}

async function fromUrl(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new ApiError(`Gambar tidak bisa diunduh (HTTP ${res.status})`, res.status)
  return Buffer.from(await res.arrayBuffer())
}

// Model gambar khusus memakai /images/generations; model multimodal (Gemini dan sejenisnya) memakai /chat/completions
export const usesImagesEndpoint = model => /^(gpt-image|dall-e|grok[\w.-]*image)/i.test(model)

export async function generateImage(auth, model, prompt, onWait) {
  if (usesImagesEndpoint(model)) {
    const d = await post(auth, '/images/generations', { model, prompt, n: 1 }, onWait)
    const item = d.data?.[0]
    if (item?.b64_json) return Buffer.from(item.b64_json, 'base64')
    if (item?.url) return fromUrl(item.url)
    throw new ApiError('Gateway tidak mengirim gambar; ulangi atau ganti subjek')
  }
  const d = await post(auth, '/chat/completions', { model, messages: [{ role: 'user', content: prompt }], modalities: ['image', 'text'] }, onWait)
  const first = d.choices?.[0]?.message?.images?.[0]
  const uri = typeof first === 'string' ? first : first?.image_url?.url
  if (!uri) throw new ApiError('Gateway tidak mengirim gambar; ulangi atau ganti subjek')
  return fromDataUri(uri) ?? fromUrl(uri)
}

// Dipakai login dan status. ok=false dengan status 401/403 berarti key ditolak; selain itu gateway tidak bisa memastikan.
export async function checkAuth(baseUrl, apiKey) {
  try {
    const res = await fetch(`${baseUrl}/models`, { headers: headers(apiKey), signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return { ok: false, status: res.status }
    const d = await res.json().catch(() => null)
    return { ok: true, models: Array.isArray(d?.data) ? d.data.length : null }
  } catch (e) {
    return { ok: false, error: e.cause?.code ?? e.message }
  }
}
