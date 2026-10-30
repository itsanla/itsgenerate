import readline from 'node:readline'

// Masukan lewat pipa dibaca sekali lalu dibagikan per baris, supaya agent dan skrip bisa login tanpa terminal
let piped = null
async function pipedLine() {
  if (!piped) {
    const chunks = []
    for await (const c of process.stdin) chunks.push(c)
    piped = Buffer.concat(chunks).toString('utf8').split(/\r?\n/)
  }
  return piped.shift() ?? ''
}

export async function ask(label) {
  if (!process.stdin.isTTY) return (await pipedLine()).trim()
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  return new Promise(resolve => {
    rl.question(label, answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

// API key tidak ditampilkan di layar
export async function askSecret(label) {
  if (!process.stdin.isTTY) return (await pipedLine()).trim()
  process.stderr.write(label)
  return new Promise((resolve, reject) => {
    let value = ''
    const stdin = process.stdin
    const done = fn => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('data', onData)
      process.stderr.write('\n')
      fn()
    }
    const onData = chunk => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\u0003') return done(() => reject(Object.assign(new Error('Dibatalkan'), { exitCode: 130 })))
        if (ch === '\r' || ch === '\n') return done(() => resolve(value.trim()))
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else value += ch
      }
    }
    stdin.setRawMode(true)
    stdin.resume()
    stdin.on('data', onData)
  })
}
