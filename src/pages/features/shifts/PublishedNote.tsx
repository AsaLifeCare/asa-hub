/** A published cell's sentence (publishedMark.publishedLine); nothing for an unmarked cell. */
import { publishedLine, type PublishedMark } from './publishedMark'

export default function PublishedNote({ mark, now }: { mark?: PublishedMark | null; now?: Date }) {
  const line = publishedLine(mark, now)
  if (!line) return null
  return (
    <p className="mt-2 rounded-sm bg-primary-soft px-2 py-1 text-[11.5px] text-primary-strong">{line}</p>
  )
}
