const VULGAR_WORDS = [
  'asshole',
  'bastard',
  'bitch',
  'bullshit',
  'cock',
  'cunt',
  'dick',
  'dickhead',
  'dumbass',
  'fag',
  'faggot',
  'fuck',
  'gay',
  'homo',
  'jackass',
  'motherfucker',
  'nigger',
  'nigga',
  'pussy',
  'retard',
  'shit',
  'slut',
  'twat',
  'whore',
].sort((a, b) => b.length - a.length);

const LEET: Record<string, string> = {
  a: '[a@4]',
  e: '[e3]',
  i: '[i1!|]',
  o: '[o0]',
  s: '[s$5]',
  c: '[c(]',
};

const SHORT_WORDS = new Set(['gay', 'homo', 'fag']);

function wordToPattern(word: string): string {
  const letters = word
    .split('')
    .map((ch) => LEET[ch] || ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\W_]*');
  const suffix = SHORT_WORDS.has(word) ? '(?:s|es)?' : '[a-z]*';
  return `${letters}${suffix}`;
}

const VULGAR_PATTERN = new RegExp(
  `(?<![a-z0-9])(${VULGAR_WORDS.map(wordToPattern).join('|')})(?![a-z0-9])`,
  'gi'
);

function maskWord(word: string): string {
  const chars = Array.from(word);
  if (chars.length <= 2) return '*'.repeat(chars.length);
  return `${chars[0]}${'*'.repeat(chars.length - 1)}`;
}

export function censorChatText(text: string): string {
  if (!text) return text;
  return text.replace(VULGAR_PATTERN, maskWord);
}
