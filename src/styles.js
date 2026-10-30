// Prompt gaya tetap: agent hanya mengganti subjek, jadi semua gambar dalam satu proyek terlihat sekeluarga.
export const STYLES = {
  ilustrasi:
    'Hand-drawn doodle illustration in the style of Odoo website marketing illustrations: confident dark navy ink outlines ' +
    '(#1d1a2e) with slightly imperfect hand-drawn strokes, flat color fills, a few small light gray secondary objects, ' +
    'friendly and family friendly. Use only one or two accent fills chosen from: warm orange #f1a55a, teal #2f7d6d, ' +
    'coral #ffaea7, soft purple #a457ff, sky blue #8ccff2. No text, no letters, no numbers, no shadows, no gradients, ' +
    'no background scene, no frame. Centered single composition with generous empty space, pure white background (#ffffff).',
  logo:
    'Flat geometric app icon in the style of a modern SaaS app launcher (like the Odoo apps icon set): built from 2 to 4 bold ' +
    'simple geometric shapes, some shapes overlapping with a slightly darker tint where they overlap, rounded corners, no ' +
    'outlines, no strokes, no text, no letters, no numbers, no gradients, no shadows, no 3D, no background shape or frame ' +
    'behind the icon. Centered, the icon fills about 70 percent of the canvas. Pure white background (#ffffff). Use ONLY ' +
    'these colors: deep teal #2f7d6d, mint #3ecf9f, warm orange #f1a55a, peach #f6d8bd, navy #22455b, muted blue #4c6fa4. ' +
    'Use at most three of them.',
}

export function buildPrompt(style, subject) {
  if (style === 'bebas') return subject
  return `Generate exactly one image. ${STYLES[style]} Subject: ${subject}`
}
