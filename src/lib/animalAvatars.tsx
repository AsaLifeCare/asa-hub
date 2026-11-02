// ANIMAL DRAWINGS AS AVATARS.
// Photographs of people who are unknown and not part of the system do not belong on a face; drawn animals do, and…

export type AnimalAvatar = { id: string; label: string; animated: boolean }

export const ANIMAL_AVATARS: AnimalAvatar[] = [
  { id: 'fox', label: 'Fox', animated: false },
  { id: 'cat', label: 'Cat', animated: false },
  { id: 'dog', label: 'Dog', animated: false },
  { id: 'bear', label: 'Bear', animated: false },
  { id: 'owl', label: 'Owl', animated: false },
  { id: 'rabbit', label: 'Rabbit', animated: false },
  { id: 'panda', label: 'Panda', animated: false },
  { id: 'frog', label: 'Frog', animated: false },
  { id: 'fox-wink', label: 'Fox, blinking', animated: true },
  { id: 'cat-tail', label: 'Cat, tail wagging', animated: true },
  { id: 'owl-blink', label: 'Owl, blinking', animated: true },
  { id: 'frog-hop', label: 'Frog, hopping', animated: true },
]

const ANIMAL_IDS = new Set(ANIMAL_AVATARS.map((a) => a.id))

/** Stored as `animal:<id>` — the same shape the icon avatars already use. */
export const animalValue = (id: string) => `animal:${id}`
export function isAnimalAvatar(value: string | undefined | null): boolean {
  const v = String(value ?? '')
  return v.startsWith('animal:') && ANIMAL_IDS.has(v.slice(7))
}
export const animalIdOf = (value: string) => String(value ?? '').slice(7)

// The palette is deliberately flat and few — a drawing beside a name should read at 24px, and shading does not…
const C = {
  fox: '#e2703a', foxLight: '#f6a97a', cat: '#8b8b92', catLight: '#c7c7cf',
  dog: '#b07a4e', dogLight: '#d9ab80', bear: '#7a5a44', bearLight: '#a98268',
  owl: '#6b6f8a', owlLight: '#a7abc4', rabbit: '#c9c3bd', rabbitLight: '#eee9e4',
  panda: '#2f3238', frog: '#4f9d5d', frogLight: '#83c78e',
  ink: '#1f2430', white: '#ffffff', pink: '#f0a3a3',
}

// One <svg> per animal.
export function AnimalAvatarSvg({ id, size = 32 }: { id: string; size?: number }) {
  const common = {
    width: size, height: size, viewBox: '0 0 48 48',
    xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': true as const,
  }
  const eye = (cx: number, blink?: string) => (
    <ellipse cx={cx} cy={26} rx={2.4} ry={3} fill={C.ink}>
      {blink && <animate attributeName="ry" values="3;0.3;3" dur="4s" begin="1s" repeatCount="indefinite" />}
    </ellipse>
  )

  switch (id) {
    case 'fox':
    case 'fox-wink':
      return (
        <svg {...common}>
          <path d="M8 14 L14 26 L6 27 Z" fill={C.fox} />
          <path d="M40 14 L34 26 L42 27 Z" fill={C.fox} />
          <ellipse cx={24} cy={27} rx={15} ry={13} fill={C.fox} />
          <path d="M24 34 a11 8 0 0 0 11-7 a24 24 0 0 1-22 0 a11 8 0 0 0 11 7Z" fill={C.foxLight} />
          {eye(18, id === 'fox-wink' ? 'blink' : undefined)}
          {eye(30, id === 'fox-wink' ? 'blink' : undefined)}
          <ellipse cx={24} cy={33} rx={2.6} ry={2} fill={C.ink} />
        </svg>
      )
    case 'cat':
    case 'cat-tail':
      return (
        <svg {...common}>
          <path d="M10 15 L15 25 L7 26 Z" fill={C.cat} />
          <path d="M38 15 L33 25 L41 26 Z" fill={C.cat} />
          <ellipse cx={24} cy={28} rx={14} ry={12} fill={C.cat} />
          <ellipse cx={24} cy={32} rx={7} ry={5} fill={C.catLight} />
          {eye(18)}
          {eye(30)}
          <path d="M24 31 l-2 2 h4 Z" fill={C.pink} />
          <g stroke={C.catLight} strokeWidth={1.2} strokeLinecap="round">
            <path d="M13 31 H6" /><path d="M35 31 H42" />
          </g>
          {id === 'cat-tail' && (
            <path d="M38 36 q7 2 5 -8" stroke={C.cat} strokeWidth={3} fill="none" strokeLinecap="round">
              <animateTransform attributeName="transform" type="rotate"
                values="0 38 36; 14 38 36; 0 38 36; -14 38 36; 0 38 36"
                dur="2.4s" repeatCount="indefinite" />
            </path>
          )}
        </svg>
      )
    case 'dog':
      return (
        <svg {...common}>
          <ellipse cx={11} cy={26} rx={5} ry={9} fill={C.dog} />
          <ellipse cx={37} cy={26} rx={5} ry={9} fill={C.dog} />
          <ellipse cx={24} cy={27} rx={14} ry={13} fill={C.dogLight} />
          {eye(19)}
          {eye(29)}
          <ellipse cx={24} cy={33} rx={3} ry={2.3} fill={C.ink} />
          <path d="M24 35 v3" stroke={C.ink} strokeWidth={1.4} strokeLinecap="round" />
        </svg>
      )
    case 'bear':
      return (
        <svg {...common}>
          <circle cx={12} cy={16} r={6} fill={C.bear} />
          <circle cx={36} cy={16} r={6} fill={C.bear} />
          <ellipse cx={24} cy={28} rx={15} ry={13} fill={C.bear} />
          <ellipse cx={24} cy={32} rx={8} ry={6} fill={C.bearLight} />
          {eye(19)}
          {eye(29)}
          <ellipse cx={24} cy={30} rx={3} ry={2.2} fill={C.ink} />
        </svg>
      )
    case 'owl':
    case 'owl-blink':
      return (
        <svg {...common}>
          <ellipse cx={24} cy={27} rx={14} ry={14} fill={C.owl} />
          <path d="M11 16 L17 22 L10 24 Z" fill={C.owl} />
          <path d="M37 16 L31 22 L38 24 Z" fill={C.owl} />
          <circle cx={18} cy={25} r={6} fill={C.owlLight} />
          <circle cx={30} cy={25} r={6} fill={C.owlLight} />
          <circle cx={18} cy={25} r={2.6} fill={C.ink}>
            {id === 'owl-blink' && <animate attributeName="r" values="2.6;0.4;2.6" dur="3.6s" repeatCount="indefinite" />}
          </circle>
          <circle cx={30} cy={25} r={2.6} fill={C.ink}>
            {id === 'owl-blink' && <animate attributeName="r" values="2.6;0.4;2.6" dur="3.6s" repeatCount="indefinite" />}
          </circle>
          <path d="M24 29 l-2.6 3 h5.2 Z" fill={C.fox} />
        </svg>
      )
    case 'rabbit':
      return (
        <svg {...common}>
          <ellipse cx={18} cy={13} rx={3.4} ry={9} fill={C.rabbit} />
          <ellipse cx={30} cy={13} rx={3.4} ry={9} fill={C.rabbit} />
          <ellipse cx={18} cy={13} rx={1.6} ry={6} fill={C.pink} />
          <ellipse cx={30} cy={13} rx={1.6} ry={6} fill={C.pink} />
          <ellipse cx={24} cy={30} rx={13} ry={11} fill={C.rabbitLight} />
          {eye(19)}
          {eye(29)}
          <path d="M24 33 l-2 2 h4 Z" fill={C.pink} />
        </svg>
      )
    case 'panda':
      return (
        <svg {...common}>
          <circle cx={12} cy={17} r={5.5} fill={C.panda} />
          <circle cx={36} cy={17} r={5.5} fill={C.panda} />
          <ellipse cx={24} cy={28} rx={15} ry={13} fill={C.white} stroke={C.panda} strokeWidth={1.2} />
          <ellipse cx={18} cy={26} rx={4.6} ry={5.4} fill={C.panda} />
          <ellipse cx={30} cy={26} rx={4.6} ry={5.4} fill={C.panda} />
          <circle cx={18} cy={26} r={1.7} fill={C.white} />
          <circle cx={30} cy={26} r={1.7} fill={C.white} />
          <ellipse cx={24} cy={33} rx={2.8} ry={2} fill={C.panda} />
        </svg>
      )
    case 'frog':
    case 'frog-hop':
      return (
        <svg {...common}>
          <g>
            {id === 'frog-hop' && (
              <animateTransform attributeName="transform" type="translate"
                values="0 0; 0 -3.5; 0 0" dur="1.8s" repeatCount="indefinite" />
            )}
            <circle cx={16} cy={19} r={6} fill={C.frog} />
            <circle cx={32} cy={19} r={6} fill={C.frog} />
            <circle cx={16} cy={19} r={2.6} fill={C.ink} />
            <circle cx={32} cy={19} r={2.6} fill={C.ink} />
            <ellipse cx={24} cy={31} rx={15} ry={11} fill={C.frog} />
            <ellipse cx={24} cy={34} rx={9} ry={5} fill={C.frogLight} />
            <path d="M17 34 q7 5 14 0" stroke={C.ink} strokeWidth={1.4} fill="none" strokeLinecap="round" />
          </g>
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <circle cx={24} cy={24} r={14} fill={C.catLight} />
        </svg>
      )
  }
}
