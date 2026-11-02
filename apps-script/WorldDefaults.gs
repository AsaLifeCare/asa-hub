// Never resurrect a default the owner deleted; never touch rows not authored by 'world-defaults'.

var WORLD_DEFAULTS_VERSION = '4';
var WORLD_DEFAULTS_TAB = 'worldDefaultsSeeded';
var WORLD_DEFAULTS_AUTHOR = 'world-defaults';

var WD_MOVE_PLANS = [
  { id: 'p-walk', title: 'Beginner walk', subtitle: 'The habit builder: out the door, back in twenty.', level: 'Beginner', place: 'Outdoor', minutes: '20', bullets: '["5 min easy pace to warm up","10 min brisk — you can talk, not sing","5 min easy to cool down"]' },
  { id: 'p-strength', title: '15-minute strength', subtitle: 'No gym, no equipment, no excuses.', level: 'Beginner', place: 'Home', minutes: '15', bullets: '["2×10 squats","2×10 countertop push-ups","2×30s plank","2×10 lunges each leg"]' },
  { id: 'p-stretch', title: 'Morning stretch', subtitle: 'Ten minutes before the day starts.', level: 'Low-impact', place: 'Outdoor', minutes: '10', bullets: '["Neck circles ×8","Shoulder rolls ×10","Cat-cow ×10","Standing forward fold, 30s"]' },
  { id: 'p-intervals', title: 'Cardio intervals', subtitle: 'Short, honest, done.', level: 'Intermediate', place: 'Gym', minutes: '20', bullets: '["4 min warm-up walk","8× (1 min fast / 1 min easy)","4 min cool-down"]' },
  { id: 'p-mobility', title: 'Gentle mobility', subtitle: 'For joints that prefer kindness.', level: 'Senior', place: 'Home', minutes: '15', bullets: '["Seated marches ×20","Sit-to-stand ×10","Ankle circles ×10 each","Wall push-ups ×10"]' },
  { id: 'p-core', title: 'Core starter', subtitle: 'The middle that carries you.', level: 'Intermediate', place: 'Home', minutes: '12', bullets: '["2×20s plank","2×12 glute bridges","2×10 bird-dogs"]' },
  { id: 'p-hike', title: 'Weekend hike prep', subtitle: 'Legs ready for the trail.', level: 'Intermediate', place: 'Outdoor', minutes: '40', bullets: '["10 min flat warm-up","20 min hills or stairs","10 min easy finish"]' },
  { id: 'p-desk', title: 'Desk break', subtitle: 'For the ones who sit all day.', level: 'Low-impact', place: 'Home', minutes: '5', bullets: '["Stand and reach up, 30s","20 shoulder rolls","10 torso twists","Walk around the room once"]' },
  { id: 'p-gym-starter', title: 'Beginner machines circuit', subtitle: 'The gym, minus the guessing.', level: 'Beginner', place: 'Gym', minutes: '30', bullets: '["5 min easy bike to warm up","Leg press, 2×12 light","Chest press, 2×12 light","Seated row, 2×12 light","5 min easy walk to finish"]' },
  { id: 'p-water-walk', title: 'Water walking', subtitle: 'The pool carries the weight, you do the work.', level: 'Beginner', place: 'Pool', minutes: '25', bullets: '["5 min slow walking in waist-deep water","15 min steady walk, arms sweeping","5 min easy, stretching at the wall"]' },
  { id: 'p-swim-steady', title: 'Steady swim', subtitle: 'Laps at a pace you can hold.', level: 'Intermediate', place: 'Pool', minutes: '30', bullets: '["4 laps easy to warm up","10× 1 lap steady, 20s rest at the wall","4 laps easy to cool down"]' },
  { id: 'p-senior-machines', title: 'Supported strength', subtitle: 'Machines hold you steady while you get stronger.', level: 'Senior', place: 'Gym', minutes: '25', bullets: '["5 min easy recumbent bike","Leg press, 2×10 very light","Seated row, 2×10 very light","Rest as long as you need between sets"]' },
  { id: 'p-aqua-gentle', title: 'Gentle aqua aerobics', subtitle: 'Kind to knees and hips, real work for the heart.', level: 'Senior', place: 'Pool', minutes: '30', bullets: '["5 min walking in the water","10 min water marching with arm swings","10 min gentle leg lifts at the wall","5 min floating stretch"]' },
  { id: 'p-balance-walk', title: 'Balance practice', subtitle: 'Steady legs, confident steps.', level: 'Senior', place: 'Outdoor', minutes: '20', bullets: '["5 min easy walk on flat ground","5× heel-to-toe walk, 10 steps","5× single-leg stand, 10s each side (hold a rail)","5 min easy walk to finish"]' },
  { id: 'p-elliptical-easy', title: 'Elliptical, kind knees', subtitle: 'Cardio without the pounding.', level: 'Low-impact', place: 'Gym', minutes: '25', bullets: '["5 min low resistance to warm up","15 min steady — you can talk, not sing","5 min easy to cool down"]' },
  { id: 'p-water-stretch', title: 'Water stretching', subtitle: 'Warm water, long muscles.', level: 'Low-impact', place: 'Pool', minutes: '20', bullets: '["5 min gentle water walking","Standing leg swings ×10 each","Wall-assisted hip stretch, 30s each","Arm circles and torso turns, 2 min"]' }
];

var WD_PLATE_GUIDES = [
  { id: 'g-adults', title: 'Adults (19–50)', subtitle: 'The steady plate.', bullets: '["Half the plate: vegetables and fruit","A quarter: protein (beans, eggs, fish, lean meat)","A quarter: whole grains","Water before soda"]' },
  { id: 'g-seniors', title: 'Seniors (65+)', subtitle: 'Protein and calcium first.', bullets: '["Protein at every meal — muscles keep the score","Milk, yogurt or fortified alternatives daily","Fiber for regularity","Smaller, more frequent meals if appetite is low"]' },
  { id: 'g-teens', title: 'Teens (13–18)', subtitle: 'Growing bodies eat more, not less.', bullets: '["Never skip breakfast","Iron-rich foods (meat, beans, spinach)","The calcium window is now — dairy daily","Water over energy drinks, always"]' },
  { id: 'g-kids', title: 'Kids (4–12)', subtitle: 'Small bodies, big habits.', bullets: '["Same food as the family, smaller portions","Fruit over juice","Milk or water at meals","They watch you — eat what you serve"]' },
  { id: 'g-diabetes', title: 'Diabetes-friendly', subtitle: 'Steady sugar, steady day.', bullets: '["Carbs spread across the day, never loaded","Pair carbs with protein or fiber","Sugary drinks out — water, unsweetened tea","Your doctor adjusts this to you"]' },
  { id: 'g-pressure', title: 'Blood-pressure-friendly', subtitle: 'Less salt, more potassium.', bullets: '["Cook with herbs, not salt","Bananas, potatoes and beans for potassium","Rinse canned goods","Processed meats: rare, not daily"]' },
  { id: 'g-cholesterol', title: 'Cholesterol-friendly', subtitle: 'Good fats in, bad fats out.', bullets: '["Olive oil over butter","Oats or barley most days","Fish twice a week","Fried food is the exception"]' },
  { id: 'g-vegetarian', title: 'Vegetarian protein', subtitle: 'Plants carry protein too.', bullets: '["Beans + rice = complete protein","Eggs and dairy if you take them","Nuts and seeds daily","B12 needs attention — ask your doctor"]' }
];

var WD_DOCTOR_SPECIALTIES = [
  { id: 's-family', title: 'Family medicine', subtitle: 'The first door: checkups, common illness, referrals.' },
  { id: 's-cardio', title: 'Cardiology', subtitle: 'Heart and pressure: chest pain, palpitations, hypertension.' },
  { id: 's-derma', title: 'Dermatology', subtitle: 'Skin, hair and nails: rashes, moles, acne.' },
  { id: 's-endo', title: 'Endocrinology', subtitle: 'Hormones: diabetes, thyroid, metabolism.' },
  { id: 's-gastro', title: 'Gastroenterology', subtitle: 'Digestion: stomach, intestines, reflux.' },
  { id: 's-gyn', title: 'Gynecology / OB', subtitle: 'Women’s health: annual exams, pregnancy.' },
  { id: 's-neuro', title: 'Neurology', subtitle: 'Brain and nerves: headaches, dizziness, numbness.' },
  { id: 's-eye', title: 'Ophthalmology', subtitle: 'Eyes: vision, pressure, diabetes checks.' },
  { id: 's-ortho', title: 'Orthopedics', subtitle: 'Bones and joints: fractures, knee and back pain.' },
  { id: 's-peds', title: 'Pediatrics', subtitle: 'Children: growth, vaccines, development.' },
  { id: 's-psych', title: 'Psychiatry', subtitle: 'Mind: depression, anxiety, medication management.' },
  { id: 's-dental', title: 'Dental', subtitle: 'Teeth and gums: a cleaning every six months.' }
];

var WD_DOCTOR_PREP = [
  { id: 'prep-annual', title: 'Annual physical', subtitle: 'The once-a-year review.', bullets: '["Bring your medication list","Bring your latest Vitals readings","Mention sleep, mood and energy — not just pain","Ask which vaccines are due"]' },
  { id: 'prep-symptom', title: 'New symptom', subtitle: 'When something changed.', bullets: '["Write when it started and how often","Note what makes it better or worse","Bring photos if it comes and goes","List everything you already tried"]' },
  { id: 'prep-followup', title: 'Follow-up', subtitle: 'After a diagnosis or procedure.', bullets: '["Bring the results of what was ordered","Say plainly what improved and what did not","Ask what to watch for next"]' },
  { id: 'prep-cardio', title: 'Cardiology visit', subtitle: 'The heart appointment.', bullets: '["Bring your blood pressure log (Vitals)","List chest symptoms with day and time","Ask about salt, caffeine and exercise limits"]' },
  { id: 'prep-endo', title: 'Endocrinology visit', subtitle: 'Diabetes and thyroid.', bullets: '["Bring your glucose log (Vitals)","Bring every medication, including supplements","Ask what your target numbers are"]' },
  { id: 'prep-derma', title: 'Dermatology visit', subtitle: 'Skin day.', bullets: '["Photograph the spot when it appears","List products you put on your skin","Point at every mole that changed"]' },
  { id: 'prep-ortho', title: 'Orthopedics visit', subtitle: 'Bones and joints.', bullets: '["Say exactly where and when it hurts","Bring old imaging if you have it","Ask what you may keep doing"]' },
  { id: 'prep-psych', title: 'Mental health visit', subtitle: 'The brave one.', bullets: '["Write how the weeks have been, in words","List sleep, appetite and energy changes","Say what you expect from the treatment"]' }
];

var WD_VITAL_RANGES = [
  { id: 'r-bp', title: 'Blood pressure', subtitle: 'Normal < 120/80 · Elevated 120–129 · High ≥ 130/80', bullets: '["Measure seated, rested 5 minutes","Same arm, same hour","Log both numbers: 120/80"]' },
  { id: 'r-glucose', title: 'Glucose (fasting)', subtitle: 'Normal 70–99 mg/dL · 100–125 watch · ≥126 see your doctor', bullets: '["Fasting = before breakfast","Log the number only: 94"]' },
  { id: 'r-hr', title: 'Heart rate (resting)', subtitle: 'Adults 60–100 bpm · trained people can read lower', bullets: '["Resting = sitting calm, 5 minutes","Log the number only: 68"]' },
  { id: 'r-temp', title: 'Temperature', subtitle: 'Normal 97.8–99.1°F · fever from 100.4°F', bullets: '["Log with the unit: 98.6°F"]' },
  { id: 'r-ox', title: 'Oxygen (SpO2)', subtitle: 'Normal 95–100% · below 92% call a doctor', bullets: '["Warm hands read truer","Log the number only: 98"]' }
];

var WD_PET_GUIDES = [
  { id: 'pet-vax-dog', title: 'Dog vaccine schedule', subtitle: 'The shots that keep them safe.', bullets: '["Rabies — every year (the law in most states)","DHPP — distemper combo, yearly","Bordetella — if boarded or social","Lepto — ask your vet about your area"]' },
  { id: 'pet-vax-cat', title: 'Cat vaccine schedule', subtitle: 'Indoor cats need them too.', bullets: '["Rabies — every year","FVRCP — the core combo, yearly","FeLV — for cats that go outside"]' },
  { id: 'pet-toxic', title: 'Toxic foods', subtitle: 'Never on the floor, never “just a bite”.', bullets: '["Chocolate, grapes and raisins","Onion, garlic, chives","Xylitol (sugar-free anything)","Alcohol, caffeine, macadamia nuts"]' },
  { id: 'pet-groom', title: 'Grooming basics', subtitle: 'Little and often beats rare and awful.', bullets: '["Nails: once a month","Teeth: weekly brushing","Bath: when dirty, not weekly","Ears: check weekly, clean if waxy"]' },
  { id: 'pet-exercise', title: 'Exercise by size', subtitle: 'Tired pets are happy pets.', bullets: '["Small dogs: ~30 min a day","Big dogs: 1–2 hours a day","Cats: two 15-min play sessions","Watch the heat — paws burn on asphalt"]' },
  { id: 'pet-redflags', title: 'Vet red flags', subtitle: 'Do not wait on these.', bullets: '["Not eating for 24h+","Vomiting repeatedly","Hard or fast breathing at rest","Hiding, or sudden aggression"]' }
];


var WORLD_DEFAULT_APPS = [
  {
    id: 'move', name: 'Move', tagline: 'Your movement, written down', icon: 'dumbbell', accent: 'green',
    main: {
      resource: 'moveWorkouts', entity: ['workout', 'workouts'],
      dsl: 'day:Day|activity:Activity|minutes:Minutes|intensity:Intensity|notes:Notes',
      columns: [
        { key: 'day', label: 'Day', kind: 'date' },
        { key: 'activity', label: 'Activity', kind: 'chip', tintBy: { Walk: 'mint', Run: 'green', Gym: 'blue', Bike: 'amber', Swim: 'lavender', Yoga: 'pink', Other: 'blue' } },
        { key: 'minutes', label: 'Minutes', kind: 'number' },
        { key: 'intensity', label: 'Intensity', kind: 'chip', tintBy: { Easy: 'mint', Moderate: 'amber', Hard: 'pink' } },
        { key: 'notes', label: 'Notes', kind: 'text', wrap: true }
      ],
      fields: [
        { key: 'day', label: 'Day', type: 'date', required: true },
        { key: 'activity', label: 'Activity', type: 'select', options: ['Walk', 'Run', 'Gym', 'Bike', 'Swim', 'Yoga', 'Other'], required: true },
        { key: 'minutes', label: 'Minutes', type: 'number', placeholder: '30' },
        { key: 'intensity', label: 'Intensity', type: 'select', options: ['Easy', 'Moderate', 'Hard'] },
        { key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'How it went…' }
      ]
    },
    extraTabs: [
      { resource: 'moveProfile', dsl: 'place:Place|level:Level|goal:Goal|daysPerWeek:Days per week', rows: [] },
      { resource: 'movePlans', dsl: 'title:Title|subtitle:Subtitle|level:Level|place:Place|minutes:Minutes|bullets:Bullets', rows: WD_MOVE_PLANS }
    ]
  },
  {
    id: 'weight', name: 'Weight', tagline: 'The trend, not the day', icon: 'scale', accent: 'mint',
    main: {
      resource: 'weightLog', entity: ['weigh-in', 'weigh-ins'],
      dsl: 'day:Day|member:Member|weightKg:Weight (kg)|waistCm:Waist (cm)|notes:Notes',
      columns: [
        { key: 'day', label: 'Day', kind: 'date' },
        { key: 'member', label: 'Member', kind: 'chip', tintBy: { Me: 'mint', Partner: 'pink', Kid: 'blue' } },
        { key: 'weightKg', label: 'Weight (kg)', kind: 'number', primary: true },
        { key: 'waistCm', label: 'Waist (cm)', kind: 'number' },
        { key: 'notes', label: 'Notes', kind: 'text', wrap: true }
      ],
      fields: [
        { key: 'day', label: 'Day', type: 'date', required: true },
        { key: 'member', label: 'Member', type: 'text' },
        { key: 'weightKg', label: 'Weight (kg)', type: 'number', required: true, placeholder: '72.4' },
        { key: 'waistCm', label: 'Waist (cm)', type: 'number' },
        { key: 'notes', label: 'Notes', type: 'textarea' }
      ]
    },
    extraPages: [
      {
        page_id: 'goals', title: 'Goals', resource: 'weightGoals', entity: ['goal', 'goals'],
        dsl: 'goal:Goal|member:Member|startWeight:Start (kg)|targetWeight:Target (kg)|since:Since|status:Status',
        columns: [
          { key: 'goal', label: 'Goal', kind: 'text', primary: true },
          { key: 'member', label: 'Member', kind: 'chip', tintBy: { Me: 'mint', Partner: 'pink', Kid: 'blue' } },
          { key: 'startWeight', label: 'Start (kg)', kind: 'number' },
          { key: 'targetWeight', label: 'Target (kg)', kind: 'number' },
          { key: 'since', label: 'Since', kind: 'date' },
          { key: 'status', label: 'Status', kind: 'chip', tintBy: { Active: 'green', Reached: 'mint', Paused: 'amber' } }
        ],
        fields: [
          { key: 'goal', label: 'Goal', type: 'text', required: true, placeholder: 'Back to 70 kg' },
          { key: 'member', label: 'Member', type: 'text' },
          { key: 'startWeight', label: 'Start (kg)', type: 'number' },
          { key: 'targetWeight', label: 'Target (kg)', type: 'number' },
          { key: 'since', label: 'Since', type: 'date' },
          { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Reached', 'Paused'] }
        ],
        rowActions: [
          { id: 'reached', label: 'Reached', icon: 'check', quick: true, kind: 'patch', when: { field: 'status', eq: 'Active' }, patch: { status: 'Reached' }, toast: 'Goal reached — congratulations.' }
        ]
      }
    ],
    extraTabs: [
      { resource: 'weightProfile', dsl: 'heightCm:Height (cm)', rows: [] },
      { resource: 'weightMembers', dsl: 'name:Name|relation:Relation|heightCm:Height (cm)', rows: [
        { id: 'me', name: 'Me', relation: 'self', heightCm: '' }
      ] }
    ]
  },
  {
    id: 'plate', name: 'Plate', tagline: 'What you eat, written down', icon: 'utensils', accent: 'peach',
    main: {
      resource: 'plateMeals', entity: ['meal', 'meals'],
      dsl: 'day:Day|meal:Meal|description:What you ate|calories:Calories',
      columns: [
        { key: 'day', label: 'Day', kind: 'date' },
        { key: 'meal', label: 'Meal', kind: 'chip', tintBy: { Breakfast: 'mint', Lunch: 'amber', Dinner: 'lavender', Snack: 'pink' } },
        { key: 'description', label: 'What you ate', kind: 'text', primary: true, wrap: true },
        { key: 'calories', label: 'Calories', kind: 'number' }
      ],
      fields: [
        { key: 'day', label: 'Day', type: 'date', required: true },
        { key: 'meal', label: 'Meal', type: 'select', options: ['Breakfast', 'Lunch', 'Dinner', 'Snack'], required: true },
        { key: 'description', label: 'What you ate', type: 'textarea', required: true, placeholder: 'Eggs, toast, coffee…' },
        { key: 'calories', label: 'Calories', type: 'number' }
      ]
    },
    extraTabs: [
      { resource: 'plateGuides', dsl: 'title:Title|subtitle:Subtitle|bullets:Bullets', rows: WD_PLATE_GUIDES }
    ]
  },
  {
    id: 'meds', name: 'Meds', tagline: 'Your medications, doses and leaflets', icon: 'pill', accent: 'blue',
    main: {
      resource: 'medsList', entity: ['medication', 'medications'],
      dsl: 'name:Medication|dose:Dose|when:When|stock:Stock|leaflet:Leaflet (URL)|lastTaken:Last taken',
      columns: [
        { key: 'name', label: 'Medication', kind: 'text', primary: true },
        { key: 'dose', label: 'Dose', kind: 'text' },
        { key: 'when', label: 'When', kind: 'chips', chipMax: 4 },
        { key: 'stock', label: 'Stock', kind: 'number' },
        { key: 'leaflet', label: 'Leaflet (URL)', kind: 'text' },
        { key: 'lastTaken', label: 'Last taken', kind: 'date' }
      ],
      fields: [
        { key: 'name', label: 'Medication', type: 'text', required: true },
        { key: 'dose', label: 'Dose', type: 'text', placeholder: '50 mg' },
        { key: 'when', label: 'When', type: 'text', placeholder: 'Morning, Night' },
        { key: 'stock', label: 'Stock', type: 'number' },
        { key: 'leaflet', label: 'Leaflet (URL)', type: 'text', placeholder: 'https://…' }
      ],
      rowActions: [
        { id: 'took-today', label: 'Took today', icon: 'check', quick: true, kind: 'patch', patch: { lastTaken: '{today}' }, toast: 'Marked as taken today.' },
        { id: 'open-leaflet', label: 'Open leaflet', icon: 'external-link', kind: 'link', when: { field: 'leaflet', neq: '' }, href: '{row.leaflet}' }
      ]
    }
  },
  {
    id: 'doctors', name: 'Doctors', tagline: 'Appointments and the people who look after you', icon: 'stethoscope', accent: 'pink',
    main: {
      resource: 'doctorVisits', entity: ['appointment', 'appointments'],
      dsl: 'day:Day|time:Time|doctor:Doctor|specialty:Specialty|place:Place|notes:Notes',
      columns: [
        { key: 'day', label: 'Day', kind: 'date' },
        { key: 'time', label: 'Time', kind: 'text' },
        { key: 'doctor', label: 'Doctor', kind: 'text', primary: true },
        { key: 'specialty', label: 'Specialty', kind: 'chip', tintBy: { 'Family medicine': 'mint', Cardiology: 'pink', Dental: 'blue', Vision: 'lavender', Other: 'amber' } },
        { key: 'place', label: 'Place', kind: 'text' },
        { key: 'notes', label: 'Notes', kind: 'text', wrap: true }
      ],
      fields: [
        { key: 'day', label: 'Day', type: 'date', required: true },
        { key: 'time', label: 'Time', type: 'text', placeholder: '14:00' },
        { key: 'doctor', label: 'Doctor', type: 'text', required: true },
        { key: 'specialty', label: 'Specialty', type: 'select', options: ['Family medicine', 'Cardiology', 'Dental', 'Vision', 'Other'] },
        { key: 'place', label: 'Place', type: 'text' },
        { key: 'notes', label: 'Notes', type: 'textarea' }
      ]
    },
    extraTabs: [
      { resource: 'doctorSpecialties', dsl: 'title:Title|subtitle:Subtitle', rows: WD_DOCTOR_SPECIALTIES },
      { resource: 'doctorPrep', dsl: 'title:Title|subtitle:Subtitle|bullets:Bullets', rows: WD_DOCTOR_PREP }
    ]
  },
  {
    id: 'vitals', name: 'Vitals', tagline: 'The numbers between doctor visits', icon: 'heart-pulse', accent: 'lavender',
    main: {
      resource: 'vitalReadings', entity: ['reading', 'readings'],
      dsl: 'day:Day|kind:Kind|value:Reading|notes:Notes',
      columns: [
        { key: 'day', label: 'Day', kind: 'date' },
        { key: 'kind', label: 'Kind', kind: 'chip', tintBy: { 'Blood pressure': 'pink', Glucose: 'amber', 'Heart rate': 'lavender', Temperature: 'blue', Oxygen: 'mint' } },
        { key: 'value', label: 'Reading', kind: 'text', primary: true },
        { key: 'notes', label: 'Notes', kind: 'text', wrap: true }
      ],
      fields: [
        { key: 'day', label: 'Day', type: 'date', required: true },
        { key: 'kind', label: 'Kind', type: 'select', options: ['Blood pressure', 'Glucose', 'Heart rate', 'Temperature', 'Oxygen'], required: true },
        { key: 'value', label: 'Reading', type: 'text', required: true, placeholder: '120/80' },
        { key: 'notes', label: 'Notes', type: 'textarea' }
      ]
    },
    extraTabs: [
      { resource: 'vitalRanges', dsl: 'title:Title|subtitle:Subtitle|bullets:Bullets', rows: WD_VITAL_RANGES }
    ]
  },
  {
    id: 'prices', name: 'Prices', tagline: 'Watch the price, buy at the low', icon: 'tag', accent: 'amber',
    main: {
      resource: 'priceWatch', entity: ['product', 'products'],
      dsl: 'product:Product|store:Store|price:Price|url:Link|checked:Last checked|status:Status',
      columns: [
        { key: 'product', label: 'Product', kind: 'text', primary: true },
        { key: 'store', label: 'Store', kind: 'text' },
        { key: 'price', label: 'Price', kind: 'number' },
        { key: 'url', label: 'Link', kind: 'text' },
        { key: 'checked', label: 'Last checked', kind: 'date' },
        { key: 'status', label: 'Status', kind: 'chip', tintBy: { Watching: 'amber', Bought: 'mint', Dropped: 'pink' } }
      ],
      fields: [
        { key: 'product', label: 'Product', type: 'text', required: true },
        { key: 'store', label: 'Store', type: 'text' },
        { key: 'price', label: 'Price', type: 'number' },
        { key: 'url', label: 'Link', type: 'text', placeholder: 'https://…' },
        { key: 'checked', label: 'Last checked', type: 'date' },
        { key: 'status', label: 'Status', type: 'select', options: ['Watching', 'Bought', 'Dropped'] }
      ],
      rowActions: [
        { id: 'checked-today', label: 'Checked today', icon: 'refresh-cw', quick: true, kind: 'patch', patch: { checked: '{today}' } },
        { id: 'open-product', label: 'Open product', icon: 'external-link', kind: 'link', when: { field: 'url', neq: '' }, href: '{row.url}' },
        { id: 'bought', label: 'Bought', icon: 'check', kind: 'patch', when: { field: 'status', eq: 'Watching' }, patch: { status: 'Bought' }, toast: 'Bought — off the watchlist.' }
      ]
    }
  },
  {
    id: 'money', name: 'Finances', tagline: 'Your money, told in plain lines', icon: 'wallet', accent: 'green',
    main: {
      resource: 'moneyMoves', entity: ['entry', 'entries'],
      dsl: 'day:Day|description:Description|category:Category|amount:Amount|direction:Direction',
      columns: [
        { key: 'day', label: 'Day', kind: 'date' },
        { key: 'description', label: 'Description', kind: 'text', primary: true, wrap: true },
        { key: 'category', label: 'Category', kind: 'chip', tintBy: { Housing: 'blue', Food: 'peach', Transport: 'amber', Health: 'pink', Fun: 'lavender', Other: 'mint' } },
        { key: 'amount', label: 'Amount', kind: 'number' },
        { key: 'direction', label: 'Direction', kind: 'chip', tintBy: { In: 'mint', Out: 'pink' } }
      ],
      fields: [
        { key: 'day', label: 'Day', type: 'date', required: true },
        { key: 'description', label: 'Description', type: 'text', required: true, placeholder: 'Groceries' },
        { key: 'category', label: 'Category', type: 'select', options: ['Housing', 'Food', 'Transport', 'Health', 'Fun', 'Other'] },
        { key: 'amount', label: 'Amount', type: 'number', required: true },
        { key: 'direction', label: 'Direction', type: 'select', options: ['In', 'Out'], required: true }
      ]
    },
    extraPages: [
      {
        page_id: 'bills', title: 'Recurring bills', resource: 'moneyBills', entity: ['bill', 'bills'],
        dsl: 'name:Bill|amount:Amount|dueDay:Due day|autopay:Autopay|lastPaid:Last paid',
        columns: [
          { key: 'name', label: 'Bill', kind: 'text', primary: true },
          { key: 'amount', label: 'Amount', kind: 'number' },
          { key: 'dueDay', label: 'Due day', kind: 'number' },
          { key: 'autopay', label: 'Autopay', kind: 'chip', tintBy: { Yes: 'mint', No: 'amber' } },
          { key: 'lastPaid', label: 'Last paid', kind: 'date' }
        ],
        fields: [
          { key: 'name', label: 'Bill', type: 'text', required: true, placeholder: 'Electricity' },
          { key: 'amount', label: 'Amount', type: 'number', required: true },
          { key: 'dueDay', label: 'Due day', type: 'number', placeholder: '15' },
          { key: 'autopay', label: 'Autopay', type: 'select', options: ['Yes', 'No'] },
          { key: 'lastPaid', label: 'Last paid', type: 'date' }
        ],
        rowActions: [
          { id: 'mark-paid', label: 'Mark paid', icon: 'check', quick: true, kind: 'patch', patch: { lastPaid: '{today}' }, toast: 'Paid — see you next month.' }
        ]
      }
    ]
  },
  {
    id: 'habits', name: 'Habits', tagline: 'Small things, every day', icon: 'repeat', accent: 'lavender',
    main: {
      resource: 'habitsLog', entity: ['entry', 'entries'],
      dsl: 'day:Day|habit:Habit|done:Status|notes:Notes',
      columns: [
        { key: 'day', label: 'Day', kind: 'date' },
        { key: 'habit', label: 'Habit', kind: 'text', primary: true },
        { key: 'done', label: 'Status', kind: 'chip', tintBy: { Done: 'mint', Planned: 'amber', Skipped: 'pink' } },
        { key: 'notes', label: 'Notes', kind: 'text', wrap: true }
      ],
      fields: [
        { key: 'day', label: 'Day', type: 'date', required: true },
        { key: 'habit', label: 'Habit', type: 'text', required: true, placeholder: 'Read 20 minutes' },
        { key: 'done', label: 'Status', type: 'select', options: ['Planned', 'Done', 'Skipped'] },
        { key: 'notes', label: 'Notes', type: 'textarea' }
      ],
      rowActions: [
        { id: 'mark-done', label: 'Mark done', icon: 'check', quick: true, kind: 'patch', when: { field: 'done', neq: 'Done' }, patch: { done: 'Done' }, toast: 'Done — one more day.' }
      ]
    }
  },
  {
    id: 'home', name: 'Home', tagline: 'The pantry and the fixes', icon: 'home', accent: 'blue',
    main: {
      resource: 'homePantry', entity: ['item', 'items'],
      dsl: 'item:Item|qty:Qty|expires:Expires|notes:Notes',
      columns: [
        { key: 'item', label: 'Item', kind: 'text', primary: true },
        { key: 'qty', label: 'Qty', kind: 'number' },
        { key: 'expires', label: 'Expires', kind: 'date', expiry: true },
        { key: 'notes', label: 'Notes', kind: 'text', wrap: true }
      ],
      fields: [
        { key: 'item', label: 'Item', type: 'text', required: true },
        { key: 'qty', label: 'Qty', type: 'number' },
        { key: 'expires', label: 'Expires', type: 'date' },
        { key: 'notes', label: 'Notes', type: 'textarea' }
      ]
    }
  },
  {
    id: 'pets', name: 'Pets', tagline: 'Shots, vets and the little ones', icon: 'paw-print', accent: 'peach',
    main: {
      resource: 'petsList', entity: ['pet', 'pets'],
      dsl: 'name:Name|species:Species|breed:Breed|vetPhone:Vet phone|notes:Notes',
      columns: [
        { key: 'name', label: 'Name', kind: 'text', primary: true },
        { key: 'species', label: 'Species', kind: 'chip', tintBy: { Dog: 'mint', Cat: 'lavender', Bird: 'blue', Other: 'amber' } },
        { key: 'breed', label: 'Breed', kind: 'text' },
        { key: 'vetPhone', label: 'Vet phone', kind: 'text', icon: 'phone' },
        { key: 'notes', label: 'Notes', kind: 'text', wrap: true }
      ],
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'species', label: 'Species', type: 'select', options: ['Dog', 'Cat', 'Bird', 'Other'] },
        { key: 'breed', label: 'Breed', type: 'text' },
        { key: 'vetPhone', label: 'Vet phone', type: 'text', placeholder: '+1…' },
        { key: 'notes', label: 'Notes', type: 'textarea' }
      ],
      rowActions: [
        { id: 'call-vet', label: 'Call vet', icon: 'phone', quick: true, kind: 'link', when: { field: 'vetPhone', neq: '' }, href: 'tel:{row.vetPhone}' }
      ]
    },
    extraPages: [
      {
        page_id: 'shots', title: 'Vaccines', resource: 'petShots', entity: ['vaccine', 'vaccines'],
        dsl: 'pet:Pet|vaccine:Vaccine|given:Given|nextDue:Next due',
        columns: [
          { key: 'pet', label: 'Pet', kind: 'text', primary: true },
          { key: 'vaccine', label: 'Vaccine', kind: 'text' },
          { key: 'given', label: 'Given', kind: 'date' },
          { key: 'nextDue', label: 'Next due', kind: 'date', expiry: true }
        ],
        fields: [
          { key: 'pet', label: 'Pet', type: 'text', required: true },
          { key: 'vaccine', label: 'Vaccine', type: 'text', required: true, placeholder: 'Rabies' },
          { key: 'given', label: 'Given', type: 'date' },
          { key: 'nextDue', label: 'Next due', type: 'date' }
        ]
      }
    ],
    extraTabs: [
      { resource: 'petGuides', dsl: 'title:Title|subtitle:Subtitle|bullets:Bullets', rows: WD_PET_GUIDES }
    ]
  },
  {
    id: 'vault', name: 'Vault', tagline: 'Your documents, one tap away', icon: 'folder-lock', accent: 'amber',
    main: {
      resource: 'vaultDocs', entity: ['document', 'documents'],
      dsl: 'title:Document|kind:Kind|url:Link|updated:Updated|notes:Notes',
      columns: [
        { key: 'title', label: 'Document', kind: 'text', primary: true },
        { key: 'kind', label: 'Kind', kind: 'chip', tintBy: { ID: 'blue', Insurance: 'mint', Health: 'pink', Money: 'amber', Home: 'lavender', Other: 'peach' } },
        { key: 'url', label: 'Link', kind: 'text' },
        { key: 'updated', label: 'Updated', kind: 'date' },
        { key: 'notes', label: 'Notes', kind: 'text', wrap: true }
      ],
      fields: [
        { key: 'title', label: 'Document', type: 'text', required: true, placeholder: 'Passport' },
        { key: 'kind', label: 'Kind', type: 'select', options: ['ID', 'Insurance', 'Health', 'Money', 'Home', 'Other'] },
        { key: 'url', label: 'Link', type: 'text', placeholder: 'https://drive.google.com/…' },
        { key: 'updated', label: 'Updated', type: 'date' },
        { key: 'notes', label: 'Notes', type: 'textarea' }
      ],
      rowActions: [
        { id: 'touch-today', label: 'Updated today', icon: 'refresh-cw', quick: true, kind: 'patch', patch: { updated: '{today}' } },
        { id: 'open-doc', label: 'Open', icon: 'external-link', kind: 'link', when: { field: 'url', neq: '' }, href: '{row.url}' }
      ]
    }
  }
];

var WORLD_DEFAULTS_KIND_ICON = { date: 'calendar', number: 'hash', chips: 'tags', chip: 'tag' };

function worldDefaultPageOptions_(app, pg) {
  var cols = pg.columns || [];
  var primary = null, chipCol = null, dateCol = null;
  for (var i = 0; i < cols.length; i++) {
    var c = cols[i];
    if (c.primary) primary = c;
    else if (!primary && c.kind === 'text') primary = c;
    if (!chipCol && c.kind === 'chip' && c.tintBy) chipCol = c;
    if (!dateCol && c.kind === 'date') dateCol = c;
  }
  if (!primary && cols.length) primary = cols[0];

  var formFields = (pg.fields || []).map(function (f) {
    var out = { key: f.key, label: f.label };
    if (f.type) out.type = f.type;
    if (f.required) out.required = true;
    if (f.options) out.options = f.options;
    if (f.placeholder) out.placeholder = f.placeholder;
    for (var j = 0; j < cols.length; j++) {
      if (cols[j].key === f.key && cols[j].tintBy) { out.tints = cols[j].tintBy; break; }
    }
    return out;
  });

  var header = { title: primary ? primary.key : 'id' };
  if (dateCol && (!primary || dateCol.key !== primary.key)) header.subtitle = dateCol.key;
  if (chipCol) header.statusChip = { field: chipCol.key, tintBy: chipCol.tintBy };

  var stats = cols.filter(function (c) { return c.kind === 'number'; })
    .slice(0, 3)
    .map(function (c) { return { label: c.label, value: c.key, icon: 'hash', tint: app.accent }; });

  var fieldsSection = {
    kind: 'fields',
    title: 'Details',
    fields: cols.map(function (c) {
      var f = { label: c.label, value: c.key };
      var icon = WORLD_DEFAULTS_KIND_ICON[c.kind] || c.icon;
      if (icon) f.icon = icon;
      if (c.wrap) f.multiline = true;
      return f;
    })
  };

  var options = {
    entity: pg.entity,
    searchable: true,
    exportable: true,
    // Must be { perm }: a bare `true` falls back to people.edit and hides delete from staff.
    rowDelete: { perm: 'tasks.edit' },
    densityToggle: true,
    pagination: { pageSize: 12 },
    columns: cols,
    primaryAction: {
      label: 'New ' + pg.entity[0],
      icon: 'plus',
      form: {
        title: 'New ' + pg.entity[0],
        resource: pg.resource,
        // tasks.edit: the one permission every role holds.
        perm: 'tasks.edit',
        wide: formFields.length >= 4,
        fields: formFields
      }
    },
    editForm: {
      title: 'Edit ' + pg.entity[0],
      resource: pg.resource,
      perm: 'tasks.edit',
      wide: formFields.length >= 4,
      fields: formFields
    },
    detailPanel: {
      header: header,
      stats: stats,
      sections: [fieldsSection]
    }
  };
  if (!stats.length) delete options.detailPanel.stats;
  if (pg.rowActions && pg.rowActions.length) options.rowActions = pg.rowActions;
  return options;
}

// An uninstalled default stays in the gallery; `installed` means rows exist, whatever their enabled flag.
function worldDefaultsSummary_(ownedIds) {
  return WORLD_DEFAULT_APPS.map(function (app) {
    return {
      id: app.id, name: app.name, tagline: app.tagline, icon: app.icon,
      accent: app.accent, category: 'Personal',
      pages: 2 + (app.extraPages ? app.extraPages.length : 0),
      installed: !!ownedIds[app.id]
    };
  });
}

function worldDefaultTab_(ss, resource, dsl, rows) {
  var cols = appBuilderColumns_(dsl);
  var state = worldEnsureDataTab_(ss, resource, cols);
  if (state === 'created' && rows && rows.length) {
    var sheet = ss.getSheetByName(resource);
    var keys = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function (h) { return String(h).trim(); });
    var seedRows = rows.map(function (rec) {
      return keys.map(function (k) {
        var v = rec[k];
        if (v === undefined || v === null) return '';
        return (typeof v === 'object') ? JSON.stringify(v) : v;
      });
    });
    sheet.getRange(2, 1, seedRows.length, keys.length).setValues(seedRows);
  }
}

// Returns the world_apps rows; the caller appends them under its own lock.
function worldSeedOneApp_(ss, ssId, app, now) {
  var rows = [];
  var pageRows = [
    { id: 'main', title: app.name, resource: app.main.resource, options: { entity: app.main.entity } },
    { id: 'data', title: 'All entries', resource: app.main.resource, options: worldDefaultPageOptions_(app, app.main) }
  ].concat((app.extraPages || []).map(function (ep) {
    return { id: ep.page_id, title: ep.title, resource: ep.resource, options: worldDefaultPageOptions_(app, ep) };
  }));

  for (var p = 0; p < pageRows.length; p++) {
    var pg = pageRows[p];
    rows.push([
      app.id, app.name, app.tagline, app.icon, app.accent, 'Personal',
      '',
      pg.id, pg.title, 'sheet', pg.resource,
      pg.dsl || app.main.dsl, JSON.stringify(pg.options),
      'TRUE',
      'Default app — yours to change, rename or delete.',
      now, WORLD_DEFAULTS_AUTHOR,
      ''                                     // tenant: always blank inside a world
    ]);
  }
  worldDefaultTab_(ss, app.main.resource, app.main.dsl, null);
  (app.extraPages || []).forEach(function (ep) {
    worldDefaultTab_(ss, ep.resource, ep.dsl, null);
  });
  (app.extraTabs || []).forEach(function (et) {
    worldDefaultTab_(ss, et.resource, et.dsl, et.rows);
  });
  worldDefaultTab_(ss, 'worldSettings', 'app:App|key:Key|value:Value', null);
  (function () {
    var bumped = {};
    pageRows.forEach(function (pg) { bumped[pg.resource] = true; });
    (app.extraTabs || []).forEach(function (et) { bumped[et.resource] = true; });
    Object.keys(bumped).forEach(function (r) { worldCacheBump_(ssId, r); });
  })();
  return rows;
}

function worldDefaultsMarker_(ss) {
  var marker = ss.getSheetByName(WORLD_DEFAULTS_TAB);
  if (!marker) {
    marker = ss.insertSheet(WORLD_DEFAULTS_TAB);
    marker.getRange(1, 1, 1, 2).setValues([['app_id', 'seeded_at']]);
    marker.setFrozenRows(1);
  }
  return marker;
}

function worldDefaultsMarked_(marker) {
  var already = {};
  var mv = marker.getDataRange().getValues();
  for (var m = 1; m < mv.length; m++) already[String(mv[m][0]).trim()] = true;
  return already;
}

function worldAppsOwnedIds_(appsSheet) {
  var owned = {};
  var av = appsSheet.getDataRange().getValues();
  var ahdr = av.length ? av[0].map(function (h) { return String(h).trim(); }) : [];
  var aidCol = ahdr.indexOf('app_id');
  var byCol = ahdr.indexOf('updated_by');
  if (aidCol === -1) return owned;
  for (var a = 1; a < av.length; a++) {
    var id = String(av[a][aidCol]).trim();
    if (id) owned[id] = byCol === -1 ? '' : String(av[a][byCol]).trim();
  }
  return owned;
}

// Deletes only rows matching the junk pattern exactly; the owner's empty drafts stay.
function worldDefaultCleanup_(ss, ssId) {
  var rules = [
    { resource: 'petsList', junk: function (get) {
      return get('name') === '' && get('notes').indexOf('Read:') === 0;
    } },
    { resource: 'plateMeals', junk: function (get) {
      return get('description').indexOf('Read the guide:') === 0;
    } },
    { resource: 'doctorVisits', junk: function (get) {
      return get('doctor') === '' && get('notes').indexOf('Looking for:') === 0;
    } },
    { resource: 'vitalReadings', junk: function (get) {
      return get('value') === '';
    } }
  ];
  var counts = {};
  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i];
    var sheet = ss.getSheetByName(rule.resource);
    if (!sheet) continue;
    var vals = sheet.getDataRange().getValues();
    if (vals.length < 2) continue;
    var header = vals[0].map(function (h) { return String(h).trim(); });
    var hit = 0;
    for (var r = vals.length - 1; r >= 1; r--) {   // bottom-up so deletions never shift pending rows
      var row = vals[r];
      var get = function (key) {
        var c = header.indexOf(key);
        return c === -1 ? '' : String(row[c]).trim();
      };
      if (rule.junk(get)) {
        sheet.deleteRow(r + 1);
        hit++;
      }
    }
    if (hit) {
      worldCacheBump_(ssId, rule.resource);
      counts[rule.resource] = hit;
    }
  }
  if (Object.keys(counts).length) {
    hubSysLog_('', 'worldDefaultCleanup', ssId, { status: 200, deleted: JSON.stringify(counts) });
  }
  return counts;
}

// absent+unmarked → seeded; absent+marked → stays gone; ours → rewritten; the owner's → untouched.
function worldSeedDefaults_(user, worldRow) {
  var ssId = str_(worldRow.spreadsheet_id);
  var ss = ssOpen_(ssId);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { seeded: [], upgraded: [], skipped: [], busy: true };
  try {
    var appsSheet = worldAppsSheet_(ss);
    var marker = worldDefaultsMarker_(ss);
    var already = worldDefaultsMarked_(marker);
    var owned = worldAppsOwnedIds_(appsSheet);

    var now = new Date().toISOString();
    var rows = [], seeded = [], upgraded = [], skipped = [], marks = [];
    for (var i = 0; i < WORLD_DEFAULT_APPS.length; i++) {
      var app = WORLD_DEFAULT_APPS[i];
      var author = owned[app.id];
      if (author !== undefined && author !== WORLD_DEFAULTS_AUTHOR) {
        skipped.push(app.id);
        continue;
      }
      if (author === undefined && already[app.id]) {
        skipped.push(app.id);
        continue;
      }
      var appRows = worldSeedOneApp_(ss, ssId, app, now);
      if (author === WORLD_DEFAULTS_AUTHOR) {
        worldDeleteRows_(appsSheet, 'app_id', app.id);
        upgraded.push(app.id);
      } else {
        seeded.push(app.id);
        marks.push([app.id, now]);
      }
      rows = rows.concat(appRows);
    }

    try {
      worldDefaultCleanup_(ss, ssId);
    } catch (eClean) {
      hubSysLog_('', 'worldDefaultCleanup', ssId, { status: 500, error: String(eClean).slice(0, 120) });
    }

    if (rows.length) {
      appsSheet.getRange(appsSheet.getLastRow() + 1, 1, rows.length, APP_BUILDER_COLUMNS.length)
               .setValues(rows);
      worldCacheBump_(ssId, WORLD_APPS_TAB);
      if (marks.length) {
        marker.getRange(marker.getLastRow() + 1, 1, marks.length, 2).setValues(marks);
      }
      hubSysLog_(str_(user && user.email), 'worldSeedDefaults', str_(worldRow.world_id),
                 { status: 200, seeded: seeded.join(','), upgraded: upgraded.join(',') });
    }
    return { seeded: seeded, upgraded: upgraded, skipped: skipped };
  } finally {
    lock.releaseLock();
  }
}

// Runs on every sign-in: must never throw, and opens the workbook only when the version moved.
function worldSeedDefaultsMaybe_(user) {
  try {
    if (!worldOffered_(user)) return;
    var row = worldRowFor_(user);
    if (!row) return;
    if (str_(row.defaults_version) === WORLD_DEFAULTS_VERSION) return;
    var res = worldSeedDefaults_(user, row);
    if (res.busy) return;
    var sheet = worldRegistrySheet_();
    var header = ensureHeader_(sheet, WORLD_REGISTRY_HEADER);
    var col = header.indexOf('defaults_version');
    if (col === -1) return;
    var vals = sheet.getDataRange().getValues();
    for (var r = 1; r < vals.length; r++) {
      var idx = header.indexOf('owner_user_id');
      if (String(vals[r][idx]).trim() === str_(user.id)) {
        sheet.getRange(r + 1, col + 1).setValue(WORLD_DEFAULTS_VERSION);
        break;
      }
    }
    cacheBump_(WORLD_REGISTRY_TAB);
  } catch (e) {
    try {
      hubSysLog_(str_(user && user.email), 'worldSeedDefaults', '',
                 { status: 500, error: String(e).slice(0, 120) });
    } catch (e2) { }
  }
}

/** Re-check the caller's world for missing default apps on demand, from Settings or the tests. */
HUB_POLICY.worldAppsSeedDefaults = {
  file: 'WorldDefaults.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  // Literal copy of WORLD_ROLES (HUB_POLICY must stay pure data); the self-test keeps them equal.
  roles: ['admin', 'manager', 'staff', 'client'],
  invalidates: [], emits: []
};
HUB_ACTIONS.worldAppsSeedDefaults = function (payload, user) {
  if (!worldOffered_(user)) return worldDenied_();
  var row = worldRowFor_(user);
  if (!row) return { status: 404, message: 'No world yet — worldEnsure creates one.' };
  var res = worldSeedDefaults_(user, row);
  if (res.busy) return { status: 409, message: 'Your world is being furnished right now — try again in a few seconds.' };
  try {
    var sheet = worldRegistrySheet_();
    var header = ensureHeader_(sheet, WORLD_REGISTRY_HEADER);
    var col = header.indexOf('defaults_version');
    var vals = sheet.getDataRange().getValues();
    for (var r = 1; r < vals.length; r++) {
      if (String(vals[r][header.indexOf('owner_user_id')]).trim() === str_(user.id)) {
        sheet.getRange(r + 1, col + 1).setValue(WORLD_DEFAULTS_VERSION);
        break;
      }
    }
    cacheBump_(WORLD_REGISTRY_TAB);
  } catch (e) { }
  return { status: 200, data: res };
};

// An explicit install overrides the marker: only the automatic seed may not resurrect.
HUB_POLICY.worldAppInstallDefault = {
  file: 'WorldDefaults.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  // Literal copy of WORLD_ROLES (HUB_POLICY must stay pure data); the self-test keeps them equal.
  roles: ['admin', 'manager', 'staff', 'client'],
  invalidates: [], emits: [],
  params: { app_id: { type: 'string', required: true } }
};
HUB_ACTIONS.worldAppInstallDefault = function (payload, user) {
  if (!worldOffered_(user)) return worldDenied_();
  var id = str_(payload && payload.app_id);
  var app = null;
  for (var i = 0; i < WORLD_DEFAULT_APPS.length; i++) {
    if (WORLD_DEFAULT_APPS[i].id === id) { app = WORLD_DEFAULT_APPS[i]; break; }
  }
  if (!app) return { status: 404, message: 'No default app "' + id + '".' };
  var row = worldRowFor_(user);
  if (!row) return { status: 404, message: 'No world yet — worldEnsure creates one.' };
  var ssId = str_(row.spreadsheet_id);
  var ss = ssOpen_(ssId);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { status: 409, message: 'Your world is being written right now — try again in a few seconds.' };
  }
  try {
    var appsSheet = worldAppsSheet_(ss);
    var owned = worldAppsOwnedIds_(appsSheet);
    if (owned[app.id] !== undefined) {
      return { status: 200, data: { id: app.id, installed: true, already: true } };
    }
    var rows = worldSeedOneApp_(ss, ssId, app, new Date().toISOString());
    appsSheet.getRange(appsSheet.getLastRow() + 1, 1, rows.length, APP_BUILDER_COLUMNS.length)
             .setValues(rows);
    worldCacheBump_(ssId, WORLD_APPS_TAB);
    var marker = worldDefaultsMarker_(ss);
    if (!worldDefaultsMarked_(marker)[app.id]) {
      marker.appendRow([app.id, new Date().toISOString()]);
    }
    hubSysLog_(str_(user.email), 'worldAppInstallDefault', app.id, { status: 200 });
    return { status: 200, data: { id: app.id, installed: true, pages: rows.length } };
  } finally {
    lock.releaseLock();
  }
};
