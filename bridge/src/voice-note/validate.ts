// ---------------------------------------------------------------------------
// isValidTranscript — guard against garbage transcripts entering the LLM
// pipeline. Without this, Groq returns "[music]" or "(silence)" or just
// whitespace for noise-heavy audio, and the LLM hallucinates an intent from
// the nothing.
//
// Pure function. No I/O. Easy to unit test.
// ---------------------------------------------------------------------------

// Noise tokens Groq emits for non-speech audio. Matched as exact phrases
// after trim + lowercase — partial sentences like "I heard music in the
// background" still pass through as legitimate customer input.
const NOISE_TOKEN_RE = /^(\[|\()?(music|inaudible|silence|background noise|applause|laughter|static|no audio|empty|blank|undefined|null)(\]|\))?\.?$/i;

export function isValidTranscript(text: string | null | undefined): boolean {
  if (!text || typeof text !== 'string') return false;

  const trimmed = text.trim();
  if (trimmed.length === 0) return false;

  // Length floor — punctuation/whitespace alone shouldn't pass.
  const stripped = trimmed.replace(/\s+/g, '');
  if (stripped.length < 2) return false;

  // Reject pure-punctuation transcripts ("...", "?!?!").
  if (/^[\s\p{P}]+$/u.test(trimmed)) return false;

  // Reject known Groq noise tokens.
  if (NOISE_TOKEN_RE.test(trimmed)) return false;

  return true;
}