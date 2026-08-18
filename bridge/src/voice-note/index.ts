// Barrel re-exports for the voice-note module.

export {
  handleVoiceNote,
  type VoiceNoteContext,
  type VoiceNoteResult,
  type VoiceNoteSkipReason,
  type MediaDownloader,
} from './handler';

export { isValidTranscript } from './validate';

export { isGroupChat } from './group-chat';

export { MessageDedupe } from './dedupe';

export { VoiceNoteRateLimit } from './rate-limit';

export {
  transcribeAudio,
  GroqAuthError,
  GroqRateLimitError,
  GroqTimeoutError,
  GroqHttpError,
  type TranscribeOptions,
  type TranscribeResult,
} from './groq-whisper';