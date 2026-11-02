// Wellbeing suite datasets (wellbeing-suite wave): client-wellbeing content derived from each client's ISP /…
// Feeds the four Ideal Meals / Workout / Sleep / Hydration feature pages.
import { withTenant } from './tenancy'

/* ============================== types ============================== */

export type WellbeingStatus = 'ready' | 'pending' | 'generating'

export type MealRecipe = {
  ingredients: string[] // 6-9 items
  steps: string[] // 4-6 steps
  allergens: string[]
  prepMin: number
  servings: number
}

/** The live rows (Wellbeing.gs) carry the ISP's `client_key`; the seed rows here do not. */
type LiveKey = { client_key?: string }

export type MealIdeal = LiveKey & {
  id: string
  clientId: string
  clientName: string
  dishName: string
  description: string
  image: string
  status: WellbeingStatus
  dietaryTags: string[]
  mealType: 'Breakfast' | 'Lunch' | 'Snack' | 'Dinner'
  recipe: MealRecipe
}

export type WorkoutPlan = LiveKey & {
  id: string
  clientId: string
  clientName: string
  activity: string
  image: string
  description: string
  durationMin: number
  intensity: 'gentle' | 'moderate'
  status: WellbeingStatus
}

export type SleepProfile = LiveKey & {
  id: string
  clientId: string
  clientName: string
  targetHours: number
  avgHours: number
  quality: number // 0-100
  bedtime: string
  wakeTime: string
  notes: string
  trend: 'up' | 'down' | 'flat'
}

export type HydrationProfile = LiveKey & {
  id: string
  clientId: string
  clientName: string
  targetOz: number
  avgOz: number
  glasses: number // of 8
  lastLogged: string
  notes: string
  trend: 'up' | 'down' | 'flat'
}

/* ============================== clients ============================== */

// First 12 seed-care clients (cl-01..cl-12) — one wellbeing row per client.
const CLIENTS: { id: string; name: string }[] = [
  { id: 'cl-01', name: 'Danny Whitaker' },
  { id: 'cl-02', name: 'Rosa Delgado' },
  { id: 'cl-03', name: 'Kenny Marsh' },
  { id: 'cl-04', name: 'Beth Ann Sutter' },
  { id: 'cl-05', name: 'Tyrone Fields' },
  { id: 'cl-06', name: 'Maggie Oconnell' },
  { id: 'cl-07', name: 'Sam Petrakis' },
  { id: 'cl-08', name: 'Joyce Linden' },
  { id: 'cl-09', name: 'Carl Draper' },
  { id: 'cl-10', name: 'Tonya Reeves' },
  { id: 'cl-11', name: 'Billy Harmon' },
  { id: 'cl-12', name: 'Annette Kowal' },
]

const mealImage = (i: number) => `/meal-${(i % 5) + 1}.jpg`
const workoutImage = (i: number) => `/workout-${(i % 5) + 1}.jpg`

/* ============================== ideal meals ============================== */

const MEALS: Omit<MealIdeal, 'id' | 'clientId' | 'clientName' | 'image' | 'recipe'>[] = [
  {
    dishName: 'Grilled Chicken Wrap',
    description:
      'Low-sodium grilled chicken wrap with soft side salad; dressing on the side and greens chopped fine for easier chewing.',
    status: 'ready',
    dietaryTags: ['low-sodium', 'easy-chew'],
    mealType: 'Lunch',
  },
  {
    dishName: 'Baked Salmon & Sweet Mash',
    description:
      'Omega-rich baked salmon with mashed sweet potato; flaked boneless and sauced to a moist, soft texture per the dysphagia diet order.',
    status: 'ready',
    dietaryTags: ['soft-texture', 'heart-healthy'],
    mealType: 'Dinner',
  },
  {
    dishName: 'Veggie Pasta Bowl',
    description:
      'Diabetic-friendly vegetable pasta with carb-counted portions and pureed carrot soup; no added salt, peanut-free kitchen prep.',
    status: 'pending',
    dietaryTags: ['diabetic-friendly', 'peanut-free'],
    mealType: 'Lunch',
  },
  {
    dishName: 'Turkey Meatloaf & Rice',
    description:
      'Minced turkey meatloaf with soft rice and diced peaches; gluten-free binder and puree-thick gravy for safe swallowing.',
    status: 'ready',
    dietaryTags: ['gluten-free', 'minced'],
    mealType: 'Dinner',
  },
  {
    dishName: 'Scrambled Egg & Oatmeal',
    description:
      'Soft scrambled eggs with creamy oatmeal and banana; lactose-free milk and a slow-feed texture matched to the morning routine.',
    status: 'ready',
    dietaryTags: ['lactose-free', 'soft-texture'],
    mealType: 'Breakfast',
  },
  {
    dishName: 'Chicken Noodle Puree Bowl',
    description:
      'Classic chicken noodle blended to a smooth pureed consistency with molded layers; nectar-thick broth per the speech-pathology note.',
    status: 'pending',
    dietaryTags: ['pureed', 'low-sodium'],
    mealType: 'Lunch',
  },
  {
    dishName: 'Baked Cod & Green Beans',
    description:
      'Lemon-free baked cod with steamed green beans; flake-tested before serving and shellfish-safe prep for the allergy profile.',
    status: 'ready',
    dietaryTags: ['shellfish-free', 'heart-healthy'],
    mealType: 'Dinner',
  },
  {
    dishName: 'Banana Pancake Stack',
    description:
      'Small-batch banana pancakes with sugar-free syrup; diabetic-friendly portions with soft, syrup-soaked texture for easy bites.',
    status: 'ready',
    dietaryTags: ['diabetic-friendly', 'easy-chew'],
    mealType: 'Breakfast',
  },
  {
    dishName: 'Beef Stew, Fork-Tender',
    description:
      'Slow-cooked beef stew, fork-tender and low-sodium; root vegetables braised soft with no latex-handled prep items.',
    status: 'pending',
    dietaryTags: ['low-sodium', 'easy-chew'],
    mealType: 'Dinner',
  },
  {
    dishName: 'Turkey Chili, Mild',
    description:
      'Mild turkey chili with beans mashed half-smooth; GERD-friendly spice level and a high-protein boost for afternoon energy.',
    status: 'ready',
    dietaryTags: ['GERD-friendly', 'high-protein'],
    mealType: 'Lunch',
  },
  {
    dishName: 'Yogurt Berry Parfait',
    description:
      'Lactose-free yogurt parfait with pureed berries; honey-thick consistency layered smooth, no granola per the aspiration precaution.',
    status: 'ready',
    dietaryTags: ['lactose-free', 'pureed'],
    mealType: 'Breakfast',
  },
  {
    dishName: 'Harvest Chicken Salad',
    description:
      'Chopped harvest chicken salad with soft apples; peanut-free, finely diced texture and a low-sodium yogurt dressing.',
    status: 'pending',
    dietaryTags: ['peanut-free', 'low-sodium'],
    mealType: 'Lunch',
  },
]

/** One recipe per MEALS entry (same index) — merged into mealIdeals below. */
const RECIPES: MealRecipe[] = [
  {
    ingredients: [
      '1 whole-wheat tortilla (8-inch)',
      '3 oz grilled chicken breast, sliced thin',
      '1/2 cup romaine lettuce, chopped fine',
      '1/4 cup shredded carrot',
      '2 tbsp low-sodium ranch, served on the side',
      '1 tsp olive oil',
      'Pinch of black pepper and garlic powder',
    ],
    steps: [
      'Season the chicken with pepper and garlic powder; brush with olive oil.',
      'Grill 6-7 minutes per side until the center reaches 165°F.',
      'Rest 5 minutes, then slice thin against the grain for easy chewing.',
      'Warm the tortilla 20 seconds so it folds without cracking.',
      'Layer lettuce, carrot and chicken; roll tight and slice in half.',
      'Serve with the dressing on the side per the low-sodium order.',
    ],
    allergens: ['gluten', 'dairy'],
    prepMin: 25,
    servings: 1,
  },
  {
    ingredients: [
      '4 oz salmon fillet, pin bones removed',
      '1 medium sweet potato, peeled and cubed',
      '1 tbsp olive oil',
      '1 clove garlic, minced',
      '2 tbsp low-sodium broth',
      '1 tsp butter',
      '1 tsp lemon-free herb blend (dill, parsley)',
      'Pinch of salt-free seasoning',
    ],
    steps: [
      'Boil the sweet potato 15 minutes until fork-soft; drain.',
      'Mash with butter and broth to a smooth, moist texture.',
      'Rub the salmon with oil, garlic and herbs.',
      'Bake at 400°F for 12-14 minutes until it flakes easily.',
      'Flake the fillet and check twice for bones before plating.',
      'Sauce lightly with pan juices so every bite stays moist.',
    ],
    allergens: ['fish', 'dairy'],
    prepMin: 35,
    servings: 1,
  },
  {
    ingredients: [
      '3/4 cup penne pasta (carb-counted portion)',
      '1/2 cup zucchini, diced small',
      '1/2 cup carrots, pureed',
      '1/2 cup no-salt-added tomato sauce',
      '1 tbsp olive oil',
      '1 tbsp grated parmesan',
      '2 basil leaves, torn',
    ],
    steps: [
      'Boil the pasta 1 minute past al dente for a softer bite; drain.',
      'Saute the zucchini in olive oil until fully tender.',
      'Stir in the carrot puree and tomato sauce; simmer 5 minutes.',
      'Fold in the pasta and toss until evenly coated.',
      'Plate in a bowl, finish with parmesan and basil.',
    ],
    allergens: ['gluten', 'dairy'],
    prepMin: 30,
    servings: 1,
  },
  {
    ingredients: [
      '4 oz ground turkey, minced fine',
      '1/4 cup gluten-free oats, ground as binder',
      '1 egg, beaten',
      '1/2 cup white rice, cooked soft',
      '1/4 cup diced peaches in juice',
      '2 tbsp onion, minced',
      '1/4 cup gravy, thickened to puree consistency',
      '1 tsp Italian herb blend',
    ],
    steps: [
      'Mix turkey, oats, egg, onion and herbs until just combined.',
      'Form a small loaf and bake at 375°F for 25-30 minutes.',
      'Rest 5 minutes, then mince to the ordered texture.',
      'Warm the gravy and thicken to a smooth, puree consistency.',
      'Serve over soft rice with diced peaches alongside.',
    ],
    allergens: ['egg'],
    prepMin: 45,
    servings: 1,
  },
  {
    ingredients: [
      '2 eggs, beaten soft',
      '2 tbsp lactose-free milk',
      '1/2 cup rolled oats',
      '1 cup lactose-free milk (for oatmeal)',
      '1/2 banana, sliced',
      '1 tsp butter',
      'Pinch of cinnamon',
      '1 tsp maple drizzle',
    ],
    steps: [
      'Simmer the oats in lactose-free milk 5 minutes until creamy.',
      'Scramble the eggs low and slow with butter until just set and soft.',
      'Fold the sliced banana into the oatmeal with cinnamon.',
      'Plate eggs beside the oatmeal; finish with a light maple drizzle.',
    ],
    allergens: ['egg', 'dairy'],
    prepMin: 15,
    servings: 1,
  },
  {
    ingredients: [
      '3 oz cooked chicken, shredded',
      '1/2 cup egg noodles, cooked very soft',
      '1/4 cup carrots, cooked tender',
      '1/4 cup celery, cooked tender',
      '1 cup low-sodium chicken broth',
      'Nectar-thick thickener per order',
      '1 tsp parsley, minced',
    ],
    steps: [
      'Blend chicken, noodles, carrots and celery with half the broth until smooth.',
      'Warm the puree gently, thinning with broth as needed.',
      'Stir thickener into the remaining broth to a nectar consistency.',
      'Combine and check the texture against the speech-pathology order.',
      'Mold into layered scoops for an appetizing plate; garnish with parsley.',
    ],
    allergens: ['gluten', 'egg'],
    prepMin: 30,
    servings: 1,
  },
  {
    ingredients: [
      '4 oz cod fillet, thawed and patted dry',
      '1 cup green beans, trimmed',
      '1 tbsp olive oil',
      '1 clove garlic, minced',
      '1 tsp salt-free herb blend',
      '1/2 cup rice pilaf',
      'Pinch of paprika',
    ],
    steps: [
      'Steam the green beans 8-10 minutes until fully tender.',
      'Rub the cod with oil, garlic, herbs and paprika.',
      'Bake at 400°F for 10-12 minutes until opaque.',
      'Flake-test the fillet twice to confirm no bones remain.',
      'Serve over rice pilaf with beans alongside.',
    ],
    allergens: ['fish'],
    prepMin: 30,
    servings: 1,
  },
  {
    ingredients: [
      '1/2 cup oat flour',
      '1 ripe banana, mashed',
      '1 egg, beaten',
      '1/4 cup lactose-free milk',
      '1 tsp baking powder',
      '1/4 tsp vanilla',
      '2 tbsp sugar-free syrup',
    ],
    steps: [
      'Whisk banana, egg, milk and vanilla until smooth.',
      'Fold in oat flour and baking powder; rest the batter 5 minutes.',
      'Cook small pancakes 2 minutes per side over medium-low heat.',
      'Stack three small cakes and soak lightly with sugar-free syrup.',
    ],
    allergens: ['egg', 'dairy'],
    prepMin: 20,
    servings: 1,
  },
  {
    ingredients: [
      '4 oz beef chuck, cut in 1-inch cubes',
      '1 carrot, cut in thick coins',
      '1 small potato, quartered',
      '1 celery stalk, sliced',
      '1 cup low-sodium beef broth',
      '1 tbsp tomato paste',
      '1 tsp thyme',
      '1 bay leaf',
    ],
    steps: [
      'Brown the beef cubes in a splash of oil; transfer to a pot.',
      'Add vegetables, broth, tomato paste, thyme and bay leaf.',
      'Simmer covered 45-60 minutes until the beef is fork-tender.',
      'Discard the bay leaf; check that every vegetable mashes with a fork.',
      'Ladle into a bowl and cool to serving temperature.',
    ],
    allergens: ['celery'],
    prepMin: 60,
    servings: 1,
  },
  {
    ingredients: [
      '4 oz ground turkey',
      '1/2 cup kidney beans, half mashed',
      '1/2 cup crushed tomatoes',
      '2 tbsp onion, diced fine',
      '1 tsp mild chili seasoning (GERD-safe)',
      '1/4 cup bell pepper, diced fine',
      '2 tbsp corn kernels',
      '1 tsp olive oil',
    ],
    steps: [
      'Brown the turkey in olive oil, breaking it up fine.',
      'Add onion and pepper; soften 4 minutes.',
      'Stir in tomatoes, beans, corn and seasoning; simmer 15 minutes.',
      'Mash half the beans against the pot for a half-smooth texture.',
      'Rest 5 minutes off heat so the spice stays mild on the stomach.',
    ],
    allergens: [],
    prepMin: 35,
    servings: 1,
  },
  {
    ingredients: [
      '3/4 cup lactose-free Greek yogurt',
      '1/4 cup strawberries, pureed smooth',
      '1/4 cup blueberries, pureed smooth',
      '1 tsp honey',
      '1/4 tsp vanilla',
      '1 tsp chia seeds, finely ground',
      '1/4 banana, mashed',
    ],
    steps: [
      'Whisk the yogurt with vanilla and honey until silky.',
      'Puree the berries and strain out any seeds.',
      'Layer yogurt, berry puree and mashed banana in a glass.',
      'Sprinkle ground chia between layers; chill 10 minutes.',
      'Confirm the honey-thick consistency before serving.',
    ],
    allergens: ['dairy'],
    prepMin: 15,
    servings: 1,
  },
  {
    ingredients: [
      '3 oz cooked chicken, diced fine',
      '1/2 soft apple, peeled and finely diced',
      '1 celery stalk, finely diced',
      '2 tbsp lactose-free yogurt dressing',
      '4 grapes, halved and deseeded',
      '1 cup romaine, chopped fine',
      '1 tsp honey mustard',
    ],
    steps: [
      'Dice the chicken to a fine, even texture.',
      'Toss with apple, celery, grapes and romaine.',
      'Whisk the yogurt dressing with honey mustard.',
      'Fold the dressing through gently until everything is coated.',
      'Chill 10 minutes and serve over the chopped romaine.',
    ],
    allergens: ['mustard', 'dairy'],
    prepMin: 20,
    servings: 1,
  },
]

export const mealIdeals: (MealIdeal & { tenantId: string })[] = withTenant(
  MEALS.map((m, i) => ({
    ...m,
    id: `meal-${String(i + 1).padStart(2, '0')}`,
    clientId: CLIENTS[i].id,
    clientName: CLIENTS[i].name,
    image: mealImage(i),
    recipe: RECIPES[i],
  })),
)

/* ============================== workout plans ============================== */

const WORKOUTS: Omit<WorkoutPlan, 'id' | 'clientId' | 'clientName' | 'image'>[] = [
  {
    activity: 'Gentle Walking',
    description:
      'Two short hallway walks with a gait belt standby; pace set by the PT note in the ISP with a rest break halfway.',
    durationMin: 20,
    intensity: 'gentle',
    status: 'ready',
  },
  {
    activity: 'Seated Stretch',
    description:
      'Chair-based morning stretch series; supports shoulder range of motion lost to cerebral palsy, one set with verbal prompts.',
    durationMin: 15,
    intensity: 'gentle',
    status: 'ready',
  },
  {
    activity: 'Balance Practice',
    description:
      'Standing balance holds beside a sturdy counter; builds fall-prevention strength flagged in the last nursing assessment.',
    durationMin: 10,
    intensity: 'moderate',
    status: 'pending',
  },
  {
    activity: 'Arm Circles',
    description:
      'Seated arm circles with 1-lb weights; hypertension-safe pacing with breathing cues between each set of ten.',
    durationMin: 12,
    intensity: 'gentle',
    status: 'ready',
  },
  {
    activity: 'Garden Stroll',
    description:
      'Supervised stroll around the backyard path; pairs vitamin-D time with light cardio, wheelchair van ramp route as backup.',
    durationMin: 25,
    intensity: 'gentle',
    status: 'ready',
  },
  {
    activity: 'Sit-to-Stand Reps',
    description:
      'Assisted sit-to-stand practice from a firm chair; two sets of five per the OT home program, staff spotting throughout.',
    durationMin: 10,
    intensity: 'moderate',
    status: 'pending',
  },
  {
    activity: 'Balloon Volley',
    description:
      'Seated balloon volleyball with housemates; low-impact coordination work that doubles as social time after lunch.',
    durationMin: 15,
    intensity: 'gentle',
    status: 'ready',
  },
  {
    activity: 'Ankle Pumps & Points',
    description:
      'Reclined ankle pumps and toe points; circulation support for diabetic foot care with a warm-up compress beforehand.',
    durationMin: 8,
    intensity: 'gentle',
    status: 'ready',
  },
  {
    activity: 'Thera-Band Rows',
    description:
      'Wheelchair-level resistance band rows; light tension only, per the orthopedic clearance after last spring’s shoulder strain.',
    durationMin: 12,
    intensity: 'moderate',
    status: 'pending',
  },
  {
    activity: 'Porch Step-Ups',
    description:
      'Supported step-ups on the single porch step; confidence work for community outings, always with one-hand assist.',
    durationMin: 10,
    intensity: 'moderate',
    status: 'ready',
  },
  {
    activity: 'Music & Movement',
    description:
      'Guided sway-and-clap session to favorite songs; sensory-friendly volume and a calm-down minute at the end.',
    durationMin: 18,
    intensity: 'gentle',
    status: 'ready',
  },
  {
    activity: 'Tai Chi Basics',
    description:
      'Seated tai chi flow video series; slow weight shifts adapted for anxiety-sensitive pacing with staff modeling alongside.',
    durationMin: 20,
    intensity: 'gentle',
    status: 'pending',
  },
]

export const workoutPlans: (WorkoutPlan & { tenantId: string })[] = withTenant(
  WORKOUTS.map((w, i) => ({
    ...w,
    id: `wo-${String(i + 1).padStart(2, '0')}`,
    clientId: CLIENTS[i].id,
    clientName: CLIENTS[i].name,
    image: workoutImage(i),
  })),
)

/* ============================== sleep profiles ============================== */

const SLEEP: Omit<SleepProfile, 'id' | 'clientId' | 'clientName'>[] = [
  { targetHours: 8, avgHours: 7.4, quality: 82, bedtime: '21:30', wakeTime: '06:30', notes: 'Settles quickly after evening meds; one brief wake-up most nights, responds to verbal reassurance.', trend: 'up' },
  { targetHours: 8, avgHours: 6.8, quality: 71, bedtime: '22:00', wakeTime: '06:00', notes: 'Restless on seizure-watch nights; weighted blanket trial starts this week per the ISP addendum.', trend: 'flat' },
  { targetHours: 9, avgHours: 8.1, quality: 77, bedtime: '21:00', wakeTime: '07:00', notes: 'Sleeps through with white-noise machine; avoid evening caffeine at workshop events.', trend: 'up' },
  { targetHours: 8, avgHours: 6.2, quality: 58, bedtime: '22:30', wakeTime: '06:30', notes: 'Frequent waking tied to GERD; elevated pillow wedge ordered, review at next nurse visit.', trend: 'down' },
  { targetHours: 8, avgHours: 7.6, quality: 85, bedtime: '21:00', wakeTime: '06:00', notes: 'Consistent routine; the bedtime reading ritual works well — keep lights dimmed after 20:30.', trend: 'up' },
  { targetHours: 9, avgHours: 7.9, quality: 74, bedtime: '21:30', wakeTime: '07:30', notes: 'Weekend sleep-ins skew the average; weekday wake cues with music improve mornings.', trend: 'flat' },
  { targetHours: 8, avgHours: 6.5, quality: 63, bedtime: '23:00', wakeTime: '06:30', notes: 'Anxiety delays sleep onset; calm-down breathing cards by the bed, PRN consult flagged.', trend: 'down' },
  { targetHours: 8, avgHours: 7.8, quality: 88, bedtime: '21:00', wakeTime: '06:00', notes: 'Best sleeper in the house; maintain current routine and room-share arrangement.', trend: 'up' },
  { targetHours: 8, avgHours: 7.1, quality: 69, bedtime: '22:00', wakeTime: '06:30', notes: 'Occasional sundowning restlessness; porch walks after dinner show a clear improvement.', trend: 'flat' },
  { targetHours: 9, avgHours: 8.4, quality: 80, bedtime: '21:30', wakeTime: '07:00', notes: 'Deep sleeper — morning meds need a firm wake prompt; night-light stays on for safety.', trend: 'up' },
  { targetHours: 8, avgHours: 6.9, quality: 66, bedtime: '22:30', wakeTime: '06:00', notes: 'Nighttime bathroom trips fragment sleep; fluid taper after 19:00 recommended by nurse.', trend: 'down' },
  { targetHours: 8, avgHours: 7.5, quality: 79, bedtime: '21:45', wakeTime: '06:15', notes: 'Sleeps best after music & movement days; keep evening sensory load low before bed.', trend: 'up' },
]

export const sleepProfiles: (SleepProfile & { tenantId: string })[] = withTenant(
  SLEEP.map((s, i) => ({
    ...s,
    id: `slp-${String(i + 1).padStart(2, '0')}`,
    clientId: CLIENTS[i].id,
    clientName: CLIENTS[i].name,
  })),
)

/* ============================== hydration profiles ============================== */

const HYDRATION: Omit<HydrationProfile, 'id' | 'clientId' | 'clientName'>[] = [
  { targetOz: 64, avgOz: 58, glasses: 6, lastLogged: '2h ago', notes: 'Prefers flavored water; keep the mint pitcher stocked and offer refills at every med pass.', trend: 'up' },
  { targetOz: 64, avgOz: 49, glasses: 5, lastLogged: '45m ago', notes: 'Needs verbal prompts; diabetic-friendly electrolyte mix approved by the dietitian.', trend: 'flat' },
  { targetOz: 72, avgOz: 66, glasses: 7, lastLogged: '1h ago', notes: 'Good intake on program days; pack a labeled bottle for the workshop van.', trend: 'up' },
  { targetOz: 56, avgOz: 38, glasses: 4, lastLogged: '3h ago', notes: 'Fluid-restriction watch with GERD — small frequent cups instead of full glasses.', trend: 'down' },
  { targetOz: 64, avgOz: 61, glasses: 7, lastLogged: '30m ago', notes: 'Drinks well from the sport bottle; straw cups discouraged per the swallow eval.', trend: 'up' },
  { targetOz: 64, avgOz: 52, glasses: 6, lastLogged: '2h ago', notes: 'Likes ice chips in the afternoon; nectar-thick liquids only per speech-pathology order.', trend: 'flat' },
  { targetOz: 72, avgOz: 55, glasses: 5, lastLogged: '1h ago', notes: 'Anxiety days dip intake; pair water breaks with the calm-down routine for consistency.', trend: 'down' },
  { targetOz: 64, avgOz: 63, glasses: 7, lastLogged: '20m ago', notes: 'Independent with the measured pitcher; logs her own stickers on the fridge chart.', trend: 'up' },
  { targetOz: 64, avgOz: 47, glasses: 5, lastLogged: '4h ago', notes: 'Refuses plain water late in the day; sugar-free lemonade is the reliable fallback.', trend: 'down' },
  { targetOz: 72, avgOz: 70, glasses: 8, lastLogged: '1h ago', notes: 'Met target five days straight; keep morning tea ritual — it anchors the whole day.', trend: 'up' },
  { targetOz: 64, avgOz: 51, glasses: 6, lastLogged: '2h ago', notes: 'Evening taper after 19:00 for sleep; front-load fluids before dinner instead.', trend: 'flat' },
  { targetOz: 64, avgOz: 59, glasses: 6, lastLogged: '50m ago', notes: 'Responds to the colorful cup rotation; two-cup rule at every meal works well.', trend: 'up' },
]

export const hydrationProfiles: (HydrationProfile & { tenantId: string })[] = withTenant(
  HYDRATION.map((h, i) => ({
    ...h,
    id: `hyd-${String(i + 1).padStart(2, '0')}`,
    clientId: CLIENTS[i].id,
    clientName: CLIENTS[i].name,
  })),
)
