const VULGAR_WORDS = [
  'asshole',
  'bastard',
  'bitch',
  'bullshit',
  'cock',
  'cunt',
  'dick',
  'dumbass',
  'fag',
  'faggot',
  'fuck',
  'jackass',
  'motherfucker',
  'nigger',
  'nigga',
  'pussy',
  'retard',
  'shit',
  'slut',
  'whore',
];

const VULGAR_PATTERN = new RegExp(
  `\\b(${VULGAR_WORDS.join('|')})(?:ing|ed|er|ers|es|s|y|ity)?\\b`,
  'gi'
);

function maskWord(word: string): string {
  if (word.length <= 2) return '*'.repeat(word.length);
  return `${word[0]}${'*'.repeat(word.length - 1)}`;
}

export function censorChatText(text: string): string {
  if (!text) return text;
  return text.replace(VULGAR_PATTERN, maskWord);
}
