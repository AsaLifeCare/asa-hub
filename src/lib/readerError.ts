// An error whose message is written for the person reading the screen: a refusal that explains itself, never a…
// A screen that would say a generic "could not load" says this sentence instead, and no global "Live API" badge or…
export type ReaderError = Error & { readonly forReader: true }

export const isReaderError = (err: unknown): err is ReaderError =>
  err instanceof Error && (err as { forReader?: unknown }).forReader === true

/** The sentence a reader error carries; '' for any other failure, so the screen keeps its own words. */
export const readerSentence = (err: unknown): string => (isReaderError(err) ? err.message : '')
