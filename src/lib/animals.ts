// THE ANIMAL LIBRARY — the platform's shared set of animal photos, replacing the stock portraits of unknown people…
// Thirteen real CC0 photographs (Openverse → Flickr/StockSnap), curated by eye — every file was opened and looked…
export type AnimalPhoto = {
  /** /assets/library/animals/<slug>.jpg — the path rows and configs carry. */
  src: string
  /** Short display name (the animal, not the artist's title). */
  label: string
  credit: string
  license: string
  source: string
}

const dir = '/assets/library/animals'

export const ANIMAL_PHOTOS: AnimalPhoto[] = [
  { src: `${dir}/cat.jpg`, label: 'Cat', credit: 'iezalel7williams', license: 'CC0 1.0', source: 'https://www.flickr.com/photos/181765699@N08/52181630725' },
  { src: `${dir}/dog.jpg`, label: 'Dog', credit: 'Reid Campbell', license: 'CC0 1.0', source: 'https://www.flickr.com/photos/195591092@N07/52065384037' },
  { src: `${dir}/red-panda.jpg`, label: 'Red panda', credit: 'Mathias Appel', license: 'CC0 1.0', source: 'https://www.flickr.com/photos/91501748@N07/52748349365' },
  { src: `${dir}/fox.jpg`, label: 'Fox', credit: 'burch19958', license: 'CC0 1.0', source: 'https://www.flickr.com/photos/192021451@N07/51690296451' },
  { src: `${dir}/barn-owl.jpg`, label: 'Owl', credit: 'Skitter Photo', license: 'CC0 1.0', source: 'https://stocksnap.io/photo/owl-bird-92D971C610' },
  { src: `${dir}/rabbit.jpg`, label: 'Rabbit', credit: 'JOHN K THORNE', license: 'CC0 1.0', source: 'https://www.flickr.com/photos/89918055@N05/52110056630' },
  { src: `${dir}/penguin.jpg`, label: 'Penguin', credit: 'Jay Ruzesky', license: 'CC0 1.0', source: 'https://stocksnap.io/photo/penguin-bird-1S833P58D0' },
  { src: `${dir}/squirrel.jpg`, label: 'Squirrel', credit: 'TonySprezzatura', license: 'CC0 1.0', source: 'https://www.flickr.com/photos/184781347@N05/52251992905' },
  { src: `${dir}/horse.jpg`, label: 'Horse', credit: 'Travel Photographer', license: 'CC0 1.0', source: 'https://stocksnap.io/photo/horse-equine-GTI8HDGB8Q' },
  { src: `${dir}/otter.jpg`, label: 'Otter', credit: 'World Wildlife', license: 'CC0 1.0', source: 'https://stocksnap.io/photo/otter-animal-XOLYSNWT9A' },
  { src: `${dir}/parrot.jpg`, label: 'Parrot', credit: 'sloalan', license: 'CC0 1.0', source: 'https://www.flickr.com/photos/8101022@N05/51732947772' },
  { src: `${dir}/turtle.jpg`, label: 'Turtle', credit: 'TonySprezzatura', license: 'CC0 1.0', source: 'https://www.flickr.com/photos/184781347@N05/52175729836' },
  { src: `${dir}/highland-cow.jpg`, label: 'Highland cow', credit: 'Simon_Cotterill', license: 'CC0 1.0', source: 'https://www.flickr.com/photos/137828720@N06/51367204232' },
]

/** The i-th animal, wrapping around — the same i always yields the same face. */
export const animalPhoto = (i: number): string =>
  ANIMAL_PHOTOS[((i % ANIMAL_PHOTOS.length) + ANIMAL_PHOTOS.length) % ANIMAL_PHOTOS.length].src
