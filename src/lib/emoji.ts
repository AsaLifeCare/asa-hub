// EMOJI, AS A DATA FILE — emotions of every kind belong in the chat.
// NO NEW DEPENDENCY, and that is a decision rather than an omission.

export type EmojiGroup = { id: string; label: string; icon: string; items: [string, string][] }

/** [glyph, search words] — the words are never displayed. */
export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    id: 'smileys',
    label: 'Smileys',
    icon: 'smile',
    items: [
      ['😀', 'grin happy smile'], ['😃', 'smile happy joy'], ['😄', 'smile happy laugh'],
      ['😁', 'grin beam happy'], ['😆', 'laugh squint haha'], ['😅', 'sweat laugh relief'],
      ['🤣', 'rofl laugh floor'], ['😂', 'joy tears laugh'], ['🙂', 'slight smile'],
      ['🙃', 'upside down silly'], ['😉', 'wink'], ['😊', 'blush smile warm'],
      ['😇', 'halo innocent angel'], ['🥰', 'love hearts adore'], ['😍', 'heart eyes love'],
      ['😘', 'kiss blow'], ['😗', 'kiss'], ['😙', 'kiss smile'], ['😚', 'kiss closed'],
      ['😋', 'yum tasty tongue'], ['😛', 'tongue'], ['😜', 'wink tongue joke'],
      ['🤪', 'zany silly wild'], ['😝', 'squint tongue'], ['🤑', 'money mouth rich'],
      ['🤗', 'hug hands'], ['🤭', 'oops hand mouth'], ['🤫', 'shush quiet secret'],
      ['🤔', 'think hmm consider'], ['🤐', 'zipper mouth quiet'], ['🤨', 'raised eyebrow doubt'],
      ['😐', 'neutral flat'], ['😑', 'expressionless'], ['😶', 'no mouth speechless'],
      ['😏', 'smirk'], ['😒', 'unamused meh'], ['🙄', 'eye roll'], ['😬', 'grimace awkward'],
      ['🤥', 'lying nose'], ['😌', 'relieved calm'], ['😔', 'pensive sad'], ['😪', 'sleepy tired'],
      ['🤤', 'drool'], ['😴', 'sleeping zzz'], ['😷', 'mask sick'], ['🤒', 'thermometer sick'],
      ['🤕', 'bandage hurt injury'], ['🤢', 'nauseated sick'], ['🤮', 'vomit sick'],
      ['🤧', 'sneeze tissue'], ['🥵', 'hot heat'], ['🥶', 'cold freezing'], ['😵', 'dizzy'],
      ['🤯', 'mind blown'], ['🤠', 'cowboy'], ['🥳', 'party celebrate'], ['😎', 'sunglasses cool'],
      ['🤓', 'nerd glasses'], ['🧐', 'monocle inspect'], ['😕', 'confused'], ['😟', 'worried'],
      ['🙁', 'frown slight'], ['😮', 'open mouth surprise'], ['😯', 'hushed'],
      ['😲', 'astonished shock'], ['😳', 'flushed embarrassed'], ['🥺', 'pleading please'],
      ['😦', 'frowning'], ['😧', 'anguished'], ['😨', 'fearful'], ['😰', 'anxious sweat'],
      ['😥', 'sad relieved'], ['😢', 'cry tear sad'], ['😭', 'sobbing cry'], ['😱', 'scream fear'],
      ['😖', 'confounded'], ['😣', 'persevere'], ['😞', 'disappointed'], ['😓', 'downcast sweat'],
      ['😩', 'weary tired'], ['😫', 'tired'], ['🥱', 'yawn'], ['😤', 'triumph steam'],
      ['😡', 'angry rage'], ['😠', 'angry'], ['🤬', 'cursing swearing'], ['😈', 'devil mischief'],
      ['💀', 'skull dead'], ['💩', 'poop'], ['🤡', 'clown'], ['👻', 'ghost'], ['👽', 'alien'],
      ['🤖', 'robot bot'],
    ],
  },
  {
    id: 'people',
    label: 'People',
    icon: 'users',
    items: [
      ['👋', 'wave hello hi bye'], ['🤚', 'raised back hand'], ['🖐️', 'hand fingers'],
      ['✋', 'hand stop high five'], ['🖖', 'vulcan spock'], ['👌', 'ok perfect'],
      ['🤏', 'pinch small'], ['✌️', 'victory peace'], ['🤞', 'fingers crossed luck'],
      ['🤟', 'love you'], ['🤘', 'rock horns'], ['🤙', 'call me shaka'], ['👈', 'point left'],
      ['👉', 'point right'], ['👆', 'point up'], ['👇', 'point down'], ['☝️', 'index up'],
      ['👍', 'thumbs up yes good agree'], ['👎', 'thumbs down no bad'], ['✊', 'fist raised'],
      ['👊', 'fist bump punch'], ['🤛', 'left fist'], ['🤜', 'right fist'],
      ['👏', 'clap applause bravo'], ['🙌', 'raised hands praise'], ['👐', 'open hands'],
      ['🤲', 'palms up'], ['🤝', 'handshake deal agree'], ['🙏', 'pray thanks please'],
      ['💪', 'muscle strong'], ['🦾', 'mechanical arm'], ['✍️', 'writing hand'],
      ['💅', 'nail polish'], ['👀', 'eyes look'], ['🧠', 'brain'], ['👶', 'baby'],
      ['🧒', 'child'], ['👦', 'boy'], ['👧', 'girl'], ['🧑', 'person'], ['👩', 'woman'],
      ['👨', 'man'], ['🧓', 'older person'], ['👵', 'older woman grandma'],
      ['👴', 'older man grandpa'], ['👮', 'police officer'], ['🕵️', 'detective'],
      ['💂', 'guard'], ['👷', 'construction worker'], ['🧑‍⚕️', 'health worker nurse doctor'],
      ['🧑‍🏫', 'teacher'], ['🧑‍🍳', 'cook chef'], ['🧑‍🔧', 'mechanic'], ['🧑‍💻', 'technologist developer'],
      ['🧑‍🦽', 'wheelchair person'], ['🧑‍🦯', 'white cane person'], ['🤰', 'pregnant'],
      ['🤱', 'breastfeeding'], ['🧑‍🤝‍🧑', 'people holding hands'], ['👪', 'family'],
      ['🚶', 'walking'], ['🏃', 'running'], ['💃', 'dancing'], ['🧘', 'yoga meditate'],
      ['🛌', 'in bed sleep'], ['🧑‍🦼', 'motorised wheelchair'],
    ],
  },
  {
    id: 'nature',
    label: 'Nature',
    icon: 'leaf',
    items: [
      ['🐶', 'dog puppy'], ['🐱', 'cat kitten'], ['🐭', 'mouse'], ['🐹', 'hamster'],
      ['🐰', 'rabbit bunny'], ['🦊', 'fox'], ['🐻', 'bear'], ['🐼', 'panda'],
      ['🐨', 'koala'], ['🐯', 'tiger'], ['🦁', 'lion'], ['🐮', 'cow'], ['🐷', 'pig'],
      ['🐸', 'frog'], ['🐵', 'monkey'], ['🐔', 'chicken'], ['🐧', 'penguin'], ['🐦', 'bird'],
      ['🦆', 'duck'], ['🦉', 'owl'], ['🐝', 'bee'], ['🦋', 'butterfly'], ['🐢', 'turtle'],
      ['🐠', 'fish'], ['🐬', 'dolphin'], ['🐳', 'whale'], ['🌲', 'evergreen tree'],
      ['🌳', 'tree'], ['🌴', 'palm tree'], ['🌵', 'cactus'], ['🌸', 'blossom flower'],
      ['🌹', 'rose'], ['🌻', 'sunflower'], ['🌷', 'tulip'], ['💐', 'bouquet flowers'],
      ['🍀', 'clover luck'], ['🍁', 'maple leaf autumn'], ['🌍', 'earth globe'],
      ['🌞', 'sun'], ['🌝', 'full moon face'], ['⭐', 'star'], ['🌟', 'glowing star'],
      ['✨', 'sparkles'], ['⚡', 'lightning'], ['🔥', 'fire hot'], ['🌈', 'rainbow'],
      ['☀️', 'sunny'], ['⛅', 'partly cloudy'], ['☁️', 'cloud'], ['🌧️', 'rain'],
      ['⛈️', 'thunderstorm'], ['❄️', 'snow cold'], ['💧', 'droplet water'],
      ['🌊', 'wave ocean'],
    ],
  },
  {
    id: 'food',
    label: 'Food',
    icon: 'utensils-crossed',
    items: [
      ['🍎', 'apple'], ['🍊', 'orange'], ['🍋', 'lemon'], ['🍌', 'banana'],
      ['🍉', 'watermelon'], ['🍇', 'grapes'], ['🍓', 'strawberry'], ['🫐', 'blueberries'],
      ['🍒', 'cherries'], ['🍑', 'peach'], ['🥭', 'mango'], ['🍍', 'pineapple'],
      ['🥥', 'coconut'], ['🥑', 'avocado'], ['🍅', 'tomato'], ['🥕', 'carrot'],
      ['🌽', 'corn'], ['🥦', 'broccoli'], ['🥬', 'greens salad'], ['🥔', 'potato'],
      ['🍞', 'bread'], ['🥐', 'croissant'], ['🥯', 'bagel'], ['🧀', 'cheese'],
      ['🥚', 'egg'], ['🍳', 'cooking fried egg'], ['🥞', 'pancakes'], ['🥓', 'bacon'],
      ['🍔', 'burger'], ['🍟', 'fries'], ['🍕', 'pizza'], ['🌭', 'hot dog'],
      ['🥪', 'sandwich'], ['🌮', 'taco'], ['🥗', 'salad'], ['🍝', 'pasta spaghetti'],
      ['🍜', 'noodles ramen'], ['🍲', 'stew soup'], ['🍚', 'rice'], ['🍗', 'chicken leg'],
      ['🥩', 'meat steak'], ['🍤', 'shrimp'], ['🍣', 'sushi'], ['🍦', 'ice cream'],
      ['🍰', 'cake slice'], ['🎂', 'birthday cake'], ['🍪', 'cookie'], ['🍫', 'chocolate'],
      ['🍬', 'candy'], ['🍿', 'popcorn'], ['☕', 'coffee'], ['🍵', 'tea'],
      ['🧃', 'juice box'], ['🥤', 'cup drink'], ['💧', 'water'], ['🍺', 'beer'],
      ['🥂', 'cheers toast'], ['🍽️', 'plate meal'],
    ],
  },
  {
    id: 'activity',
    label: 'Activity',
    icon: 'trophy',
    items: [
      ['⚽', 'soccer football'], ['🏀', 'basketball'], ['🏈', 'american football'],
      ['⚾', 'baseball'], ['🎾', 'tennis'], ['🏐', 'volleyball'], ['🏓', 'ping pong'],
      ['🏸', 'badminton'], ['🥊', 'boxing'], ['🥋', 'martial arts'], ['⛳', 'golf'],
      ['🎣', 'fishing'], ['🏊', 'swimming'], ['🚴', 'cycling'], ['🧗', 'climbing'],
      ['🏋️', 'weight lifting gym'], ['🤸', 'cartwheel'], ['🏆', 'trophy win'],
      ['🥇', 'first place gold'], ['🥈', 'second place silver'], ['🥉', 'third place bronze'],
      ['🏅', 'medal'], ['🎯', 'target bullseye'], ['🎲', 'dice game'], ['🎮', 'video game'],
      ['🎨', 'art palette'], ['🎭', 'theatre'], ['🎤', 'microphone sing'], ['🎧', 'headphones'],
      ['🎵', 'music note'], ['🎸', 'guitar'], ['🥁', 'drum'], ['🎬', 'film clapper'],
      ['📸', 'camera photo'], ['🎉', 'party popper celebrate'], ['🎊', 'confetti'],
      ['🎁', 'gift present'], ['🎈', 'balloon'],
    ],
  },
  {
    id: 'travel',
    label: 'Travel',
    icon: 'car',
    items: [
      ['🚗', 'car'], ['🚕', 'taxi'], ['🚙', 'suv'], ['🚌', 'bus'], ['🚐', 'van minibus'],
      ['🚑', 'ambulance'], ['🚒', 'fire engine'], ['🚓', 'police car'], ['🛻', 'pickup truck'],
      ['🚚', 'truck delivery'], ['🚜', 'tractor'], ['🏍️', 'motorcycle'], ['🚲', 'bicycle'],
      ['🛴', 'scooter'], ['♿', 'wheelchair accessible'], ['🚶', 'pedestrian'],
      ['✈️', 'airplane flight'], ['🚀', 'rocket launch'], ['🚢', 'ship'], ['⛵', 'sailboat'],
      ['🚂', 'train'], ['🚇', 'metro subway'], ['🗺️', 'map'], ['📍', 'pin location'],
      ['🏠', 'house home'], ['🏡', 'house garden'], ['🏢', 'office building'],
      ['🏥', 'hospital'], ['🏫', 'school'], ['⛪', 'church'], ['🏖️', 'beach'],
      ['🏔️', 'mountain'], ['🌃', 'night city'], ['🌉', 'bridge'], ['⛺', 'tent camping'],
      ['🧳', 'luggage'], ['⛽', 'fuel gas'], ['🚦', 'traffic light'], ['🛑', 'stop sign'],
    ],
  },
  {
    id: 'objects',
    label: 'Objects',
    icon: 'lightbulb',
    items: [
      ['⌚', 'watch'], ['📱', 'phone mobile'], ['💻', 'laptop computer'], ['🖥️', 'desktop'],
      ['🖨️', 'printer'], ['⌨️', 'keyboard'], ['🖱️', 'mouse'], ['💾', 'floppy save'],
      ['📷', 'camera'], ['🎥', 'video camera'], ['📞', 'telephone call'], ['☎️', 'phone'],
      ['📟', 'pager'], ['📠', 'fax'], ['📺', 'television'], ['📻', 'radio'],
      ['🔋', 'battery'], ['🔌', 'plug power'], ['💡', 'idea lightbulb'], ['🔦', 'flashlight'],
      ['🕯️', 'candle'], ['🧯', 'fire extinguisher'], ['🛢️', 'oil drum'], ['💰', 'money bag'],
      ['💳', 'credit card'], ['🧾', 'receipt'], ['💵', 'dollar cash'], ['🔑', 'key'],
      ['🔒', 'lock secure'], ['🔓', 'unlock'], ['🔨', 'hammer'], ['🪛', 'screwdriver'],
      ['🔧', 'wrench fix'], ['⚙️', 'gear settings'], ['🧰', 'toolbox'], ['🧲', 'magnet'],
      ['🧪', 'test tube lab'], ['🌡️', 'thermometer'], ['💊', 'pill medication'],
      ['💉', 'syringe injection'], ['🩹', 'bandage plaster'], ['🩺', 'stethoscope'],
      ['🚪', 'door'], ['🛏️', 'bed'], ['🚿', 'shower'], ['🛁', 'bath'], ['🧴', 'lotion soap'],
      ['🧻', 'toilet paper'], ['🧼', 'soap wash'], ['🧹', 'broom clean'], ['🧺', 'laundry basket'],
      ['🧽', 'sponge'], ['🛒', 'shopping cart'], ['📦', 'package box'], ['📬', 'mailbox'],
      ['✉️', 'envelope email'], ['📅', 'calendar date'], ['📆', 'calendar'],
      ['📋', 'clipboard'], ['📌', 'pushpin'], ['📎', 'paperclip'], ['✂️', 'scissors'],
      ['📝', 'memo note write'], ['📄', 'page document'], ['📊', 'bar chart'],
      ['📈', 'chart up growth'], ['📉', 'chart down'], ['📚', 'books'], ['📖', 'open book'],
      ['🔍', 'search magnify'], ['🔔', 'bell notification'], ['🔕', 'bell off mute'],
      ['⏰', 'alarm clock'], ['⏳', 'hourglass wait'], ['⌛', 'hourglass done'],
    ],
  },
  {
    id: 'symbols',
    label: 'Symbols',
    icon: 'heart',
    items: [
      ['❤️', 'red heart love'], ['🧡', 'orange heart'], ['💛', 'yellow heart'],
      ['💚', 'green heart'], ['💙', 'blue heart'], ['💜', 'purple heart'],
      ['🖤', 'black heart'], ['🤍', 'white heart'], ['💔', 'broken heart'],
      ['💕', 'two hearts'], ['💖', 'sparkling heart'], ['💯', 'hundred perfect'],
      ['✅', 'check done yes'], ['☑️', 'ballot check'], ['✔️', 'check mark'],
      ['❌', 'cross no wrong'], ['❎', 'cross mark button'], ['⭕', 'circle'],
      ['❗', 'exclamation important'], ['❓', 'question'], ['⚠️', 'warning caution'],
      ['🚫', 'prohibited no'], ['🔴', 'red circle'], ['🟠', 'orange circle'],
      ['🟡', 'yellow circle'], ['🟢', 'green circle'], ['🔵', 'blue circle'],
      ['⚫', 'black circle'], ['⚪', 'white circle'], ['🔺', 'red triangle up'],
      ['🔻', 'red triangle down'], ['➕', 'plus add'], ['➖', 'minus'], ['➗', 'divide'],
      ['♾️', 'infinity'], ['🔁', 'repeat loop'], ['🔄', 'refresh sync'], ['▶️', 'play'],
      ['⏸️', 'pause'], ['⏹️', 'stop'], ['⏭️', 'next'], ['🔀', 'shuffle'],
      ['⬆️', 'up arrow'], ['⬇️', 'down arrow'], ['⬅️', 'left arrow'], ['➡️', 'right arrow'],
      ['🔝', 'top'], ['🆕', 'new'], ['🆗', 'ok'], ['🆘', 'sos help'], ['🈵', 'full'],
      ['💤', 'sleep zzz'], ['💬', 'speech bubble'], ['🗨️', 'left speech'],
      ['💭', 'thought bubble'], ['🕐', 'clock time'],
    ],
  },
  {
    id: 'flags',
    label: 'Flags',
    icon: 'flag',
    items: [
      ['🏳️', 'white flag'], ['🏴', 'black flag'], ['🏁', 'chequered finish'],
      ['🚩', 'triangular flag'], ['🏳️‍🌈', 'rainbow pride'], ['🇺🇸', 'united states usa'],
      ['🇧🇷', 'brazil'], ['🇲🇽', 'mexico'], ['🇨🇦', 'canada'], ['🇵🇹', 'portugal'],
      ['🇪🇸', 'spain'], ['🇬🇧', 'united kingdom'], ['🇮🇪', 'ireland'], ['🇩🇪', 'germany'],
      ['🇫🇷', 'france'], ['🇮🇹', 'italy'], ['🇵🇭', 'philippines'], ['🇮🇳', 'india'],
      ['🇳🇬', 'nigeria'], ['🇰🇪', 'kenya'], ['🇬🇭', 'ghana'], ['🇯🇵', 'japan'],
      ['🇨🇳', 'china'], ['🇰🇷', 'south korea'], ['🇻🇳', 'vietnam'], ['🇺🇦', 'ukraine'],
      ['🇵🇱', 'poland'], ['🇷🇺', 'russia'], ['🇨🇺', 'cuba'], ['🇩🇴', 'dominican republic'],
      ['🇭🇹', 'haiti'], ['🇯🇲', 'jamaica'], ['🇨🇴', 'colombia'], ['🇻🇪', 'venezuela'],
      ['🇵🇪', 'peru'], ['🇦🇷', 'argentina'],
    ],
  },
]

/** The eight or so a workplace reaches for, offered without opening anything. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '🙏', '👏', '😮', '😢']

const RECENT_KEY = 'asa-emoji-recent'
const RECENT_MAX = 24

/** Per person, per browser — a preference, never global (platform law). */
export function recentEmoji(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

export function rememberEmoji(glyph: string): string[] {
  const next = [glyph, ...recentEmoji().filter((g) => g !== glyph)].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* a full localStorage costs the recents, nothing else */
  }
  return next
}

// Search across every group.
export function searchEmoji(query: string, limit = 60): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: string[] = []
  for (const group of EMOJI_GROUPS) {
    for (const [glyph, words] of group.items) {
      if (!words.split(' ').some((w) => w.startsWith(q))) continue
      if (!out.includes(glyph)) out.push(glyph)
      if (out.length >= limit) return out
    }
  }
  return out
}
