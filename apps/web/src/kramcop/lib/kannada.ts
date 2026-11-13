const CONSONANTS: [string, string][] = [
  ['ksh', 'ಕ್ಷ'],
  ['jny', 'ಜ್ಞ'],
  ['jn', 'ಜ್ಞ'],
  ['kh', 'ಖ'],
  ['gh', 'ಘ'],
  ['chh', 'ಛ'],
  ['Ch', 'ಛ'],
  ['ch', 'ಚ'],
  ['jh', 'ಝ'],
  ['th', 'ಥ'],
  ['dh', 'ಧ'],
  ['ph', 'ಫ'],
  ['bh', 'ಭ'],
  ['sh', 'ಶ'],
  ['Sh', 'ಷ'],
  ['Th', 'ಠ'],
  ['Dh', 'ಢ'],
  ['Ng', 'ಙ'],
  ['ny', 'ಞ'],
  ['ng', 'ಙ'],
  ['k', 'ಕ'],
  ['g', 'ಗ'],
  ['c', 'ಚ'],
  ['j', 'ಜ'],
  ['T', 'ಟ'],
  ['D', 'ಡ'],
  ['N', 'ಣ'],
  ['t', 'ತ'],
  ['d', 'ದ'],
  ['n', 'ನ'],
  ['p', 'ಪ'],
  ['b', 'ಬ'],
  ['m', 'ಮ'],
  ['y', 'ಯ'],
  ['r', 'ರ'],
  ['l', 'ಲ'],
  ['L', 'ಳ'],
  ['v', 'ವ'],
  ['w', 'ವ'],
  ['s', 'ಸ'],
  ['h', 'ಹ'],
  ['f', 'ಫ'],
  ['z', 'ಜ'],
  ['q', 'ಕ'],
  ['x', 'ಕ್ಷ'],
]

const VOWELS: [string, string][] = [
  ['ai', 'ಐ'],
  ['au', 'ಔ'],
  ['aa', 'ಆ'],
  ['ee', 'ಈ'],
  ['oo', 'ಊ'],
  ['A', 'ಆ'],
  ['I', 'ಈ'],
  ['U', 'ಊ'],
  ['E', 'ಏ'],
  ['O', 'ಓ'],
  ['a', 'ಅ'],
  ['i', 'ಇ'],
  ['u', 'ಉ'],
  ['e', 'ಎ'],
  ['o', 'ಒ'],
  ['R', 'ಋ'],
]

const DEPENDENT: Record<string, string> = {
  ಅ: '',
  ಆ: 'ಾ',
  ಇ: 'ಿ',
  ಈ: 'ೀ',
  ಉ: 'ು',
  ಊ: 'ೂ',
  ಋ: 'ೃ',
  ಎ: 'ೆ',
  ಏ: 'ೇ',
  ಐ: 'ೈ',
  ಒ: 'ೊ',
  ಓ: 'ೋ',
  ಔ: 'ೌ',
}

const HALANT = '್'
const KANNADA = /[\u0C80-\u0CFF]/

function match(table: [string, string][], text: string, i: number): [string, string] | null {
  for (const pair of table) {
    if (text.startsWith(pair[0], i)) return pair
  }
  return null
}

export function transliterateWord(word: string): string {
  if (!word) return ''
  if (KANNADA.test(word) && !/[A-Za-z]/.test(word)) return word

  const out: string[] = []
  let i = 0
  let pending: string | null = null

  const flush = (vowel?: string, virama = false) => {
    if (pending === null) {
      if (vowel) out.push(vowel)
      return
    }
    if (vowel !== undefined) out.push(pending + (DEPENDENT[vowel] ?? ''))
    else if (virama) out.push(pending + HALANT)
    else out.push(pending)
    pending = null
  }

  while (i < word.length) {
    const ch = word[i]
    if ((ch === 'M' || ch === 'm') && pending !== null) {
      flush()
      out.push('ಂ')
      i += 1
      continue
    }
    if (ch === 'H' && pending !== null) {
      flush()
      out.push('ಃ')
      i += 1
      continue
    }
    let cons = match(CONSONANTS, word, i)
    let vow = match(VOWELS, word, i)
    if (cons && vow) {
      if (cons[0].length >= vow[0].length) vow = null
      else cons = null
    }
    if (cons) {
      if (pending !== null) out.push(pending + HALANT)
      pending = cons[1]
      i += cons[0].length
      continue
    }
    if (vow) {
      flush(vow[1])
      i += vow[0].length
      continue
    }
    flush()
    out.push(ch)
    i += 1
  }
  flush()
  return out.join('')
}

export function englishToKannada(text: string): string {
  if (!text) return ''
  if (KANNADA.test(text) && !/[A-Za-z]/.test(text)) return text
  return text
    .split(/(\s+)/)
    .map((part) => {
      if (!part || /^\s+$/.test(part)) return part
      return part
        .split(/([A-Za-z]+)/)
        .map((chunk) => (chunk && /[A-Za-z]/.test(chunk) ? transliterateWord(chunk) : chunk))
        .join('')
    })
    .join('')
}

export function hasLatin(text: string) {
  return /[A-Za-z]/.test(text)
}
