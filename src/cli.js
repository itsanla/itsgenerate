import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { checkAuth, generateImage } from './api.js'
import { configFile, loadAuth, maskKey, normalizeBaseUrl, removeAuth, saveAuth, storedBaseUrl } from './config.js'
import { ask, askSecret } from './prompt.js'
import { buildPrompt, STYLES } from './styles.js'

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const DEFAULT_MODEL = 'gemini-3.1-flash-image'
const GAYA = [...Object.keys(STYLES), 'bebas']

const HELP = `itsgenerate ${VERSION}
Membuat gambar lewat gateway AI berformat OpenAI.

Pemakaian:
  itsgenerate <perintah> [pilihan]

Perintah:
  image <subjek>   Buat gambar dari subjek
  auth login       Simpan base URL dan API key
  auth status      Tampilkan kredensial yang dipakai dan uji koneksi
  auth logout      Hapus kredensial tersimpan

Pilihan umum:
  -h, --help       Tampilkan bantuan
  -v, --version    Tampilkan versi

Bantuan per perintah: itsgenerate image --help, itsgenerate auth --help
`

const IMAGE_HELP = `Pemakaian:
  itsgenerate image [pilihan] "<subjek>"

Pilihan:
  -g, --gaya <gaya>     ilustrasi (bawaan), logo, atau bebas
  -o, --out <berkas>    Berkas keluaran (bawaan: gambar-<waktu>.webp)
  -m, --model <model>   Model gambar (bawaan: ${DEFAULT_MODEL}, atau env ITSGENERATE_MODEL)
  -k, --kandidat <n>    Buat n kandidat: nama-1.webp, nama-2.webp, ... (1 sampai 10)
      --lembar <berkas> Satukan kandidat dalam satu PNG untuk ditinjau
  -h, --help            Tampilkan bantuan

Gaya:
  ilustrasi   Doodle bergaris tinta, latar transparan, sisi terpanjang paling besar 720 px
  logo        Ikon datar geometris, latar transparan, 256 x 256 px
  bebas       Subjek dikirim apa adanya tanpa prompt gaya, latar tidak diubah

Keluaran:
  Path tiap berkas hasil dicetak ke stdout, satu per baris. Progres dan galat ke stderr.
  Kode keluar: 0 berhasil, 1 galat, 2 salah pemakaian, 3 belum login atau key ditolak.

Contoh:
  itsgenerate image -o login.webp "a teacher waving at a school gate"
  itsgenerate image -g logo -k 2 --lembar tinjau.png -o modul.webp "a stack of books"
`

const AUTH_HELP = `Pemakaian:
  itsgenerate auth login    Tanya base URL dan API key, lalu simpan
  itsgenerate auth status   Tampilkan kredensial yang dipakai dan uji koneksi
  itsgenerate auth logout   Hapus kredensial tersimpan

Tanpa terminal, login membaca dua baris dari stdin (base URL lalu API key).
Env ITSGENERATE_BASE_URL dan ITSGENERATE_API_KEY didahulukan daripada berkas tersimpan.
`

const usageError = message => Object.assign(new Error(message), { exitCode: 2 })

async function login() {
  const current = storedBaseUrl()
  const rawUrl = (await ask(`Base URL${current ? ` [${current}]` : ''}: `)) || current
  if (!rawUrl) throw usageError('Base URL wajib diisi')
  const baseUrl = normalizeBaseUrl(rawUrl)
  const apiKey = await askSecret('API key: ')
  if (!apiKey) throw usageError('API key wajib diisi')
  const check = await checkAuth(baseUrl, apiKey)
  if (check.status === 401 || check.status === 403) {
    throw Object.assign(new Error(`Key ditolak gateway (HTTP ${check.status}), tidak disimpan`), { exitCode: 3 })
  }
  saveAuth(baseUrl, apiKey)
  console.log(`Tersimpan di ${configFile()}`)
  if (!check.ok) console.error(`Peringatan: koneksi belum bisa dipastikan (${check.error ?? `HTTP ${check.status}`})`)
  return 0
}

async function status() {
  const auth = loadAuth()
  if (!auth) {
    console.log('Belum login. Jalankan: itsgenerate auth login')
    return 3
  }
  console.log(`Base URL  ${auth.baseUrl}`)
  console.log(`API key   ${maskKey(auth.apiKey)}`)
  console.log(`Sumber    ${auth.fromEnv ? 'variabel lingkungan' : configFile()}`)
  const check = await checkAuth(auth.baseUrl, auth.apiKey)
  if (check.ok) {
    console.log(`Koneksi   OK${check.models === null ? '' : `, ${check.models} model`}`)
    return 0
  }
  console.log(`Koneksi   gagal (${check.error ?? `HTTP ${check.status}`})`)
  return check.status === 401 || check.status === 403 ? 3 : 1
}

function logout() {
  console.log(removeAuth() ? 'Kredensial dihapus.' : 'Tidak ada kredensial tersimpan.')
  if (process.env.ITSGENERATE_API_KEY || process.env.ITSGENERATE_BASE_URL) {
    console.error('Catatan: variabel lingkungan ITSGENERATE_* masih aktif.')
  }
  return 0
}

function auth(args) {
  if (args[0] === 'login') return login()
  if (args[0] === 'status') return status()
  if (args[0] === 'logout') return logout()
  if (!args.length || args[0] === '-h' || args[0] === '--help') {
    process.stdout.write(AUTH_HELP)
    return args.length ? 0 : 2
  }
  throw usageError(`Perintah auth tidak dikenal: ${args[0]}\n\n${AUTH_HELP}`)
}

const defaultOut = () => `gambar-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}.webp`

async function image(args) {
  let parsed
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        gaya: { type: 'string', short: 'g', default: 'ilustrasi' },
        out: { type: 'string', short: 'o' },
        model: { type: 'string', short: 'm' },
        kandidat: { type: 'string', short: 'k', default: '1' },
        lembar: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (e) {
    throw usageError(`${e.message}\n\n${IMAGE_HELP}`)
  }
  const { values: v, positionals } = parsed
  if (v.help) {
    process.stdout.write(IMAGE_HELP)
    return 0
  }
  const subject = positionals.join(' ').trim()
  if (!subject) throw usageError(`Subjek wajib diisi\n\n${IMAGE_HELP}`)
  if (!GAYA.includes(v.gaya)) throw usageError(`Gaya tidak dikenal: ${v.gaya}. Pilihan: ${GAYA.join(', ')}`)
  const count = Number(v.kandidat)
  if (!Number.isInteger(count) || count < 1 || count > 10) throw usageError('--kandidat harus 1 sampai 10')
  const creds = loadAuth()
  if (!creds) throw Object.assign(new Error('Belum login. Jalankan: itsgenerate auth login'), { exitCode: 3 })

  const model = v.model || process.env.ITSGENERATE_MODEL || DEFAULT_MODEL
  const out = v.out || defaultOut()
  const ext = path.extname(out)
  const targets = count === 1 ? [out] : Array.from({ length: count }, (_, i) => `${out.slice(0, out.length - ext.length)}-${i + 1}${ext}`)
  // sharp baru dimuat di sini, supaya --help dan auth tetap jalan walau pustaka native bermasalah
  const { contactSheet, saveStyled } = await import('./process.js')

  // berurutan, bukan paralel: gateway biasanya membatasi jumlah permintaan per menit
  const prompt = buildPrompt(v.gaya, subject)
  for (const [i, target] of targets.entries()) {
    console.error(`[${i + 1}/${targets.length}] ${model}: membuat ${target}`)
    const buffer = await generateImage(creds, model, prompt, ms => console.error(`Batas gateway tercapai, menunggu ${ms / 1000} detik`))
    await saveStyled(buffer, v.gaya, target)
    console.log(target)
  }
  if (v.lembar) {
    await contactSheet(targets, v.lembar)
    console.log(v.lembar)
  }
  return 0
}

export async function main(args) {
  const [command, ...rest] = args
  if (!command || command === '-h' || command === '--help' || command === 'help') {
    process.stdout.write(HELP)
    return command ? 0 : 2
  }
  if (command === '-v' || command === '--version') {
    console.log(VERSION)
    return 0
  }
  if (command === 'auth') return auth(rest)
  if (command === 'image') return image(rest)
  throw usageError(`Perintah tidak dikenal: ${command}\n\n${HELP}`)
}
