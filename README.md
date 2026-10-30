# itsgenerate

CLI pembuat gambar lewat gateway AI berformat OpenAI. Dibuat supaya AI agent bisa menghasilkan ilustrasi dan logo dengan gaya
yang konsisten lewat satu perintah: prompt gaya sudah terkunci, agent cukup menulis subjeknya.

## Pasang

```bash
npm install -g itsgenerate
```

Butuh Node.js 20 atau lebih baru.

## Login

```bash
itsgenerate auth login    # tanya base URL dan API key
itsgenerate auth status   # tampilkan kredensial yang dipakai dan uji koneksi
itsgenerate auth logout   # hapus kredensial tersimpan
```

API key tidak ditampilkan saat diketik dan disimpan di `~/.config/itsgenerate/config.json` dengan mode 600. Key yang ditolak
gateway tidak disimpan.

Tanpa terminal, `auth login` membaca dua baris dari stdin. Variabel `ITSGENERATE_BASE_URL` dan `ITSGENERATE_API_KEY`
didahulukan daripada berkas tersimpan.

## Membuat gambar

```bash
itsgenerate image -o login.webp "a teacher waving at a school gate"
itsgenerate image -g logo -o modul.webp "a stack of books"
itsgenerate image -k 2 --lembar tinjau.png -o sampul.webp "three kids waving"
itsgenerate image -g bebas -o foto.png "a watercolor mountain"
```

| Gaya | Hasil |
|---|---|
| `ilustrasi` (bawaan) | Doodle bergaris tinta, latar transparan, sisi terpanjang paling besar 720 px |
| `logo` | Ikon datar geometris, latar transparan, 256 x 256 px |
| `bebas` | Subjek dikirim apa adanya, latar tidak diubah |

Tulis subjek dalam bahasa Inggris. Gaya `ilustrasi` dan `logo` menyimpan `.webp` atau `.png`.

Model bawaan `gemini-3.1-flash-image`. Ganti dengan `--model` atau `ITSGENERATE_MODEL`. Model `gpt-image-*`, `dall-e-*`, dan
`grok-*-image` memakai `/images/generations`; model lain memakai `/chat/completions` dengan `modalities: ["image", "text"]`.

## Untuk agent dan skrip

- Path tiap berkas hasil dicetak ke stdout, satu per baris. Progres dan galat ke stderr.
- Kode keluar: `0` berhasil, `1` galat, `2` salah pemakaian, `3` belum login atau key ditolak.
- Kandidat dibuat berurutan. Saat gateway membalas HTTP 429, CLI menunggu 30 detik dan mencoba lagi sampai dua kali.

## Lisensi

MIT
