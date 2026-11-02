"""WorldDefaults.gs's default apps, the ones every world is furnished with: their pages' options
(worldDefaultPageOptions_), the gallery's summary (worldDefaultsSummary_), and the apps themselves with the guide rows
their tabs are seeded with."""
from __future__ import annotations

from typing import Any

import gsjs

VERSION = "4"
MARKER_TAB = "worldDefaultsSeeded"
MARKER_HEADER = ["app_id", "seeded_at"]
AUTHOR = "world-defaults"
SETTINGS_TAB = "worldSettings"
SETTINGS_DSL = "app:App|key:Key|value:Value"
NOTE = "Default app — yours to change, rename or delete."
KIND_ICON = {"date": "calendar", "number": "hash", "chips": "tags", "chip": "tag"}


def _truthy(v: Any) -> bool:
    return not gsjs.falsy(v)


def page_options(app: dict[str, Any], pg: dict[str, Any]) -> dict[str, Any]:
    """worldDefaultPageOptions_: a page's list, forms and detail panel out of its columns and fields."""
    cols = pg.get("columns") or []
    primary = chip_col = date_col = None
    for c in cols:
        if _truthy(c.get("primary")):
            primary = c
        elif primary is None and c.get("kind") == "text":
            primary = c
        if chip_col is None and c.get("kind") == "chip" and _truthy(c.get("tintBy")):
            chip_col = c
        if date_col is None and c.get("kind") == "date":
            date_col = c
    if primary is None and cols:
        primary = cols[0]

    form_fields = []
    for f in pg.get("fields") or []:
        out: dict[str, Any] = {"key": f.get("key"), "label": f.get("label")}
        if _truthy(f.get("type")):
            out["type"] = f["type"]
        if _truthy(f.get("required")):
            out["required"] = True
        if _truthy(f.get("options")):
            out["options"] = f["options"]
        if _truthy(f.get("placeholder")):
            out["placeholder"] = f["placeholder"]
        tinted = next((c for c in cols if c.get("key") == f.get("key") and _truthy(c.get("tintBy"))), None)
        if tinted is not None:
            out["tints"] = tinted["tintBy"]
        form_fields.append(out)

    header: dict[str, Any] = {"title": primary["key"] if primary is not None else "id"}
    if date_col is not None and (primary is None or date_col.get("key") != primary.get("key")):
        header["subtitle"] = date_col["key"]
    if chip_col is not None:
        header["statusChip"] = {"field": chip_col["key"], "tintBy": chip_col["tintBy"]}

    stats = [{"label": c.get("label"), "value": c.get("key"), "icon": "hash", "tint": app.get("accent")}
             for c in cols if c.get("kind") == "number"][:3]

    fields = []
    for c in cols:
        f2: dict[str, Any] = {"label": c.get("label"), "value": c.get("key")}
        icon = KIND_ICON.get(c.get("kind")) or c.get("icon")
        if _truthy(icon):
            f2["icon"] = icon
        if _truthy(c.get("wrap")):
            f2["multiline"] = True
        fields.append(f2)

    entity = pg["entity"]
    form = {"title": "New " + entity[0], "resource": pg["resource"], "perm": "tasks.edit",
            "wide": len(form_fields) >= 4, "fields": form_fields}
    options: dict[str, Any] = {
        "entity": entity, "searchable": True, "exportable": True, "rowDelete": {"perm": "tasks.edit"},
        "densityToggle": True, "pagination": {"pageSize": 12}, "columns": cols,
        "primaryAction": {"label": "New " + entity[0], "icon": "plus", "form": form},
        "editForm": {"title": "Edit " + entity[0], "resource": pg["resource"], "perm": "tasks.edit",
                     "wide": len(form_fields) >= 4, "fields": form_fields},
        "detailPanel": {"header": header, "stats": stats, "sections": [{"kind": "fields", "title": "Details",
                                                                         "fields": fields}]},
    }
    if not stats:
        del options["detailPanel"]["stats"]
    if pg.get("rowActions"):
        options["rowActions"] = pg["rowActions"]
    return options


def summary(owned: dict[str, Any]) -> list[dict[str, Any]]:
    """worldDefaultsSummary_: every default for the gallery; `installed` means rows exist, whatever their enabled
    flag."""
    return [{"id": a["id"], "name": a["name"], "tagline": a["tagline"], "icon": a["icon"], "accent": a["accent"],
             "category": "Personal", "pages": 2 + len(a.get("extraPages") or []), "installed": bool(owned.get(a["id"]))}
            for a in WORLD_DEFAULT_APPS]


def find(app_id: str) -> dict[str, Any] | None:
    return next((a for a in WORLD_DEFAULT_APPS if a["id"] == app_id), None)


# ---- the defaults themselves -------------------------------------------------------------------------------------

WD_MOVE_PLANS = [
    {
        "id": "p-walk", "title": "Beginner walk", "subtitle": "The habit builder: out the door, back in twenty.",
        "level": "Beginner", "place": "Outdoor", "minutes": "20",
        "bullets": (
            "[\"5 min easy pace to warm up\",\"10 min brisk — you can talk, not sing\",\"5 min easy to cool down\"]"
        ),
    },
    {
        "id": "p-strength", "title": "15-minute strength", "subtitle": "No gym, no equipment, no excuses.",
        "level": "Beginner", "place": "Home", "minutes": "15",
        "bullets": "[\"2×10 squats\",\"2×10 countertop push-ups\",\"2×30s plank\",\"2×10 lunges each leg\"]",
    },
    {
        "id": "p-stretch", "title": "Morning stretch", "subtitle": "Ten minutes before the day starts.",
        "level": "Low-impact", "place": "Outdoor", "minutes": "10",
        "bullets": "[\"Neck circles ×8\",\"Shoulder rolls ×10\",\"Cat-cow ×10\",\"Standing forward fold, 30s\"]",
    },
    {
        "id": "p-intervals", "title": "Cardio intervals", "subtitle": "Short, honest, done.", "level": "Intermediate",
        "place": "Gym", "minutes": "20",
        "bullets": "[\"4 min warm-up walk\",\"8× (1 min fast / 1 min easy)\",\"4 min cool-down\"]",
    },
    {
        "id": "p-mobility", "title": "Gentle mobility", "subtitle": "For joints that prefer kindness.",
        "level": "Senior", "place": "Home", "minutes": "15",
        "bullets": "[\"Seated marches ×20\",\"Sit-to-stand ×10\",\"Ankle circles ×10 each\",\"Wall push-ups ×10\"]",
    },
    {
        "id": "p-core", "title": "Core starter", "subtitle": "The middle that carries you.", "level": "Intermediate",
        "place": "Home", "minutes": "12", "bullets": "[\"2×20s plank\",\"2×12 glute bridges\",\"2×10 bird-dogs\"]",
    },
    {
        "id": "p-hike", "title": "Weekend hike prep", "subtitle": "Legs ready for the trail.", "level": "Intermediate",
        "place": "Outdoor", "minutes": "40",
        "bullets": "[\"10 min flat warm-up\",\"20 min hills or stairs\",\"10 min easy finish\"]",
    },
    {
        "id": "p-desk", "title": "Desk break", "subtitle": "For the ones who sit all day.", "level": "Low-impact",
        "place": "Home", "minutes": "5",
        "bullets": (
            "[\"Stand and reach up, 30s\",\"20 shoulder rolls\",\"10 torso twists\",\"Walk around the room once\"]"
        ),
    },
    {
        "id": "p-gym-starter", "title": "Beginner machines circuit", "subtitle": "The gym, minus the guessing.",
        "level": "Beginner", "place": "Gym", "minutes": "30",
        "bullets": (
            "[\"5 min easy bike to warm up\",\"Leg press, 2×12 light\",\"Chest press, 2×12 light\",\"Seated row, 2×12"
            " light\",\"5 min easy walk to finish\"]"
        ),
    },
    {
        "id": "p-water-walk", "title": "Water walking", "subtitle": "The pool carries the weight, you do the work.",
        "level": "Beginner", "place": "Pool", "minutes": "25",
        "bullets": (
            "[\"5 min slow walking in waist-deep water\",\"15 min steady walk, arms sweeping\",\"5 min easy, stretchi"
            "ng at the wall\"]"
        ),
    },
    {
        "id": "p-swim-steady", "title": "Steady swim", "subtitle": "Laps at a pace you can hold.",
        "level": "Intermediate", "place": "Pool", "minutes": "30",
        "bullets": (
            "[\"4 laps easy to warm up\",\"10× 1 lap steady, 20s rest at the wall\",\"4 laps easy to cool down\"]"
        ),
    },
    {
        "id": "p-senior-machines", "title": "Supported strength",
        "subtitle": "Machines hold you steady while you get stronger.", "level": "Senior", "place": "Gym",
        "minutes": "25",
        "bullets": (
            "[\"5 min easy recumbent bike\",\"Leg press, 2×10 very light\",\"Seated row, 2×10 very light\",\"Rest as "
            "long as you need between sets\"]"
        ),
    },
    {
        "id": "p-aqua-gentle", "title": "Gentle aqua aerobics",
        "subtitle": "Kind to knees and hips, real work for the heart.", "level": "Senior", "place": "Pool",
        "minutes": "30",
        "bullets": (
            "[\"5 min walking in the water\",\"10 min water marching with arm swings\",\"10 min gentle leg lifts at t"
            "he wall\",\"5 min floating stretch\"]"
        ),
    },
    {
        "id": "p-balance-walk", "title": "Balance practice", "subtitle": "Steady legs, confident steps.",
        "level": "Senior", "place": "Outdoor", "minutes": "20",
        "bullets": (
            "[\"5 min easy walk on flat ground\",\"5× heel-to-toe walk, 10 steps\",\"5× single-leg stand, 10s each si"
            "de (hold a rail)\",\"5 min easy walk to finish\"]"
        ),
    },
    {
        "id": "p-elliptical-easy", "title": "Elliptical, kind knees", "subtitle": "Cardio without the pounding.",
        "level": "Low-impact", "place": "Gym", "minutes": "25",
        "bullets": (
            "[\"5 min low resistance to warm up\",\"15 min steady — you can talk, not sing\",\"5 min easy to cool dow"
            "n\"]"
        ),
    },
    {
        "id": "p-water-stretch", "title": "Water stretching", "subtitle": "Warm water, long muscles.",
        "level": "Low-impact", "place": "Pool", "minutes": "20",
        "bullets": (
            "[\"5 min gentle water walking\",\"Standing leg swings ×10 each\",\"Wall-assisted hip stretch, 30s each\""
            ",\"Arm circles and torso turns, 2 min\"]"
        ),
    },
]

WD_PLATE_GUIDES = [
    {
        "id": "g-adults", "title": "Adults (19–50)", "subtitle": "The steady plate.",
        "bullets": (
            "[\"Half the plate: vegetables and fruit\",\"A quarter: protein (beans, eggs, fish, lean meat)\",\"A quar"
            "ter: whole grains\",\"Water before soda\"]"
        ),
    },
    {
        "id": "g-seniors", "title": "Seniors (65+)", "subtitle": "Protein and calcium first.",
        "bullets": (
            "[\"Protein at every meal — muscles keep the score\",\"Milk, yogurt or fortified alternatives daily\",\"F"
            "iber for regularity\",\"Smaller, more frequent meals if appetite is low\"]"
        ),
    },
    {
        "id": "g-teens", "title": "Teens (13–18)", "subtitle": "Growing bodies eat more, not less.",
        "bullets": (
            "[\"Never skip breakfast\",\"Iron-rich foods (meat, beans, spinach)\",\"The calcium window is now — dairy"
            " daily\",\"Water over energy drinks, always\"]"
        ),
    },
    {
        "id": "g-kids", "title": "Kids (4–12)", "subtitle": "Small bodies, big habits.",
        "bullets": (
            "[\"Same food as the family, smaller portions\",\"Fruit over juice\",\"Milk or water at meals\",\"They wa"
            "tch you — eat what you serve\"]"
        ),
    },
    {
        "id": "g-diabetes", "title": "Diabetes-friendly", "subtitle": "Steady sugar, steady day.",
        "bullets": (
            "[\"Carbs spread across the day, never loaded\",\"Pair carbs with protein or fiber\",\"Sugary drinks out "
            "— water, unsweetened tea\",\"Your doctor adjusts this to you\"]"
        ),
    },
    {
        "id": "g-pressure", "title": "Blood-pressure-friendly", "subtitle": "Less salt, more potassium.",
        "bullets": (
            "[\"Cook with herbs, not salt\",\"Bananas, potatoes and beans for potassium\",\"Rinse canned goods\",\"Pr"
            "ocessed meats: rare, not daily\"]"
        ),
    },
    {
        "id": "g-cholesterol", "title": "Cholesterol-friendly", "subtitle": "Good fats in, bad fats out.",
        "bullets": (
            "[\"Olive oil over butter\",\"Oats or barley most days\",\"Fish twice a week\",\"Fried food is the except"
            "ion\"]"
        ),
    },
    {
        "id": "g-vegetarian", "title": "Vegetarian protein", "subtitle": "Plants carry protein too.",
        "bullets": (
            "[\"Beans + rice = complete protein\",\"Eggs and dairy if you take them\",\"Nuts and seeds daily\",\"B12 "
            "needs attention — ask your doctor\"]"
        ),
    },
]

WD_DOCTOR_SPECIALTIES = [
    {"id": "s-family", "title": "Family medicine", "subtitle": "The first door: checkups, common illness, referrals."},
    {
        "id": "s-cardio", "title": "Cardiology",
        "subtitle": "Heart and pressure: chest pain, palpitations, hypertension.",
    },
    {"id": "s-derma", "title": "Dermatology", "subtitle": "Skin, hair and nails: rashes, moles, acne."},
    {"id": "s-endo", "title": "Endocrinology", "subtitle": "Hormones: diabetes, thyroid, metabolism."},
    {"id": "s-gastro", "title": "Gastroenterology", "subtitle": "Digestion: stomach, intestines, reflux."},
    {"id": "s-gyn", "title": "Gynecology / OB", "subtitle": "Women’s health: annual exams, pregnancy."},
    {"id": "s-neuro", "title": "Neurology", "subtitle": "Brain and nerves: headaches, dizziness, numbness."},
    {"id": "s-eye", "title": "Ophthalmology", "subtitle": "Eyes: vision, pressure, diabetes checks."},
    {"id": "s-ortho", "title": "Orthopedics", "subtitle": "Bones and joints: fractures, knee and back pain."},
    {"id": "s-peds", "title": "Pediatrics", "subtitle": "Children: growth, vaccines, development."},
    {"id": "s-psych", "title": "Psychiatry", "subtitle": "Mind: depression, anxiety, medication management."},
    {"id": "s-dental", "title": "Dental", "subtitle": "Teeth and gums: a cleaning every six months."},
]

WD_DOCTOR_PREP = [
    {
        "id": "prep-annual", "title": "Annual physical", "subtitle": "The once-a-year review.",
        "bullets": (
            "[\"Bring your medication list\",\"Bring your latest Vitals readings\",\"Mention sleep, mood and energy —"
            " not just pain\",\"Ask which vaccines are due\"]"
        ),
    },
    {
        "id": "prep-symptom", "title": "New symptom", "subtitle": "When something changed.",
        "bullets": (
            "[\"Write when it started and how often\",\"Note what makes it better or worse\",\"Bring photos if it com"
            "es and goes\",\"List everything you already tried\"]"
        ),
    },
    {
        "id": "prep-followup", "title": "Follow-up", "subtitle": "After a diagnosis or procedure.",
        "bullets": (
            "[\"Bring the results of what was ordered\",\"Say plainly what improved and what did not\",\"Ask what to "
            "watch for next\"]"
        ),
    },
    {
        "id": "prep-cardio", "title": "Cardiology visit", "subtitle": "The heart appointment.",
        "bullets": (
            "[\"Bring your blood pressure log (Vitals)\",\"List chest symptoms with day and time\",\"Ask about salt, "
            "caffeine and exercise limits\"]"
        ),
    },
    {
        "id": "prep-endo", "title": "Endocrinology visit", "subtitle": "Diabetes and thyroid.",
        "bullets": (
            "[\"Bring your glucose log (Vitals)\",\"Bring every medication, including supplements\",\"Ask what your t"
            "arget numbers are\"]"
        ),
    },
    {
        "id": "prep-derma", "title": "Dermatology visit", "subtitle": "Skin day.",
        "bullets": (
            "[\"Photograph the spot when it appears\",\"List products you put on your skin\",\"Point at every mole th"
            "at changed\"]"
        ),
    },
    {
        "id": "prep-ortho", "title": "Orthopedics visit", "subtitle": "Bones and joints.",
        "bullets": (
            "[\"Say exactly where and when it hurts\",\"Bring old imaging if you have it\",\"Ask what you may keep do"
            "ing\"]"
        ),
    },
    {
        "id": "prep-psych", "title": "Mental health visit", "subtitle": "The brave one.",
        "bullets": (
            "[\"Write how the weeks have been, in words\",\"List sleep, appetite and energy changes\",\"Say what you "
            "expect from the treatment\"]"
        ),
    },
]

WD_VITAL_RANGES = [
    {
        "id": "r-bp", "title": "Blood pressure", "subtitle": "Normal < 120/80 · Elevated 120–129 · High ≥ 130/80",
        "bullets": "[\"Measure seated, rested 5 minutes\",\"Same arm, same hour\",\"Log both numbers: 120/80\"]",
    },
    {
        "id": "r-glucose", "title": "Glucose (fasting)",
        "subtitle": "Normal 70–99 mg/dL · 100–125 watch · ≥126 see your doctor",
        "bullets": "[\"Fasting = before breakfast\",\"Log the number only: 94\"]",
    },
    {
        "id": "r-hr", "title": "Heart rate (resting)", "subtitle": "Adults 60–100 bpm · trained people can read lower",
        "bullets": "[\"Resting = sitting calm, 5 minutes\",\"Log the number only: 68\"]",
    },
    {
        "id": "r-temp", "title": "Temperature", "subtitle": "Normal 97.8–99.1°F · fever from 100.4°F",
        "bullets": "[\"Log with the unit: 98.6°F\"]",
    },
    {
        "id": "r-ox", "title": "Oxygen (SpO2)", "subtitle": "Normal 95–100% · below 92% call a doctor",
        "bullets": "[\"Warm hands read truer\",\"Log the number only: 98\"]",
    },
]

WD_PET_GUIDES = [
    {
        "id": "pet-vax-dog", "title": "Dog vaccine schedule", "subtitle": "The shots that keep them safe.",
        "bullets": (
            "[\"Rabies — every year (the law in most states)\",\"DHPP — distemper combo, yearly\",\"Bordetella — if b"
            "oarded or social\",\"Lepto — ask your vet about your area\"]"
        ),
    },
    {
        "id": "pet-vax-cat", "title": "Cat vaccine schedule", "subtitle": "Indoor cats need them too.",
        "bullets": "[\"Rabies — every year\",\"FVRCP — the core combo, yearly\",\"FeLV — for cats that go outside\"]",
    },
    {
        "id": "pet-toxic", "title": "Toxic foods", "subtitle": "Never on the floor, never “just a bite”.",
        "bullets": (
            "[\"Chocolate, grapes and raisins\",\"Onion, garlic, chives\",\"Xylitol (sugar-free anything)\",\"Alcohol"
            ", caffeine, macadamia nuts\"]"
        ),
    },
    {
        "id": "pet-groom", "title": "Grooming basics", "subtitle": "Little and often beats rare and awful.",
        "bullets": (
            "[\"Nails: once a month\",\"Teeth: weekly brushing\",\"Bath: when dirty, not weekly\",\"Ears: check weekl"
            "y, clean if waxy\"]"
        ),
    },
    {
        "id": "pet-exercise", "title": "Exercise by size", "subtitle": "Tired pets are happy pets.",
        "bullets": (
            "[\"Small dogs: ~30 min a day\",\"Big dogs: 1–2 hours a day\",\"Cats: two 15-min play sessions\",\"Watch "
            "the heat — paws burn on asphalt\"]"
        ),
    },
    {
        "id": "pet-redflags", "title": "Vet red flags", "subtitle": "Do not wait on these.",
        "bullets": (
            "[\"Not eating for 24h+\",\"Vomiting repeatedly\",\"Hard or fast breathing at rest\",\"Hiding, or sudden "
            "aggression\"]"
        ),
    },
]

WORLD_DEFAULT_APPS = [
    {
        "id": "move", "name": "Move", "tagline": "Your movement, written down", "icon": "dumbbell", "accent": "green",
        "main": {
            "resource": "moveWorkouts", "entity": ["workout", "workouts"],
            "dsl": "day:Day|activity:Activity|minutes:Minutes|intensity:Intensity|notes:Notes",
            "columns": [
                {"key": "day", "label": "Day", "kind": "date"},
                {
                    "key": "activity", "label": "Activity", "kind": "chip",
                    "tintBy": {
                        "Walk": "mint", "Run": "green", "Gym": "blue", "Bike": "amber", "Swim": "lavender",
                        "Yoga": "pink", "Other": "blue",
                    },
                },
                {"key": "minutes", "label": "Minutes", "kind": "number"},
                {
                    "key": "intensity", "label": "Intensity", "kind": "chip",
                    "tintBy": {"Easy": "mint", "Moderate": "amber", "Hard": "pink"},
                },
                {"key": "notes", "label": "Notes", "kind": "text", "wrap": True},
            ],
            "fields": [
                {"key": "day", "label": "Day", "type": "date", "required": True},
                {
                    "key": "activity", "label": "Activity", "type": "select",
                    "options": ["Walk", "Run", "Gym", "Bike", "Swim", "Yoga", "Other"], "required": True,
                },
                {"key": "minutes", "label": "Minutes", "type": "number", "placeholder": "30"},
                {"key": "intensity", "label": "Intensity", "type": "select", "options": ["Easy", "Moderate", "Hard"]},
                {"key": "notes", "label": "Notes", "type": "textarea", "placeholder": "How it went…"},
            ],
        },
        "extraTabs": [
            {
                "resource": "moveProfile", "dsl": "place:Place|level:Level|goal:Goal|daysPerWeek:Days per week",
                "rows": [],
            },
            {
                "resource": "movePlans",
                "dsl": "title:Title|subtitle:Subtitle|level:Level|place:Place|minutes:Minutes|bullets:Bullets",
                "rows": WD_MOVE_PLANS,
            },
        ],
    },
    {
        "id": "weight", "name": "Weight", "tagline": "The trend, not the day", "icon": "scale", "accent": "mint",
        "main": {
            "resource": "weightLog", "entity": ["weigh-in", "weigh-ins"],
            "dsl": "day:Day|member:Member|weightKg:Weight (kg)|waistCm:Waist (cm)|notes:Notes",
            "columns": [
                {"key": "day", "label": "Day", "kind": "date"},
                {
                    "key": "member", "label": "Member", "kind": "chip",
                    "tintBy": {"Me": "mint", "Partner": "pink", "Kid": "blue"},
                },
                {"key": "weightKg", "label": "Weight (kg)", "kind": "number", "primary": True},
                {"key": "waistCm", "label": "Waist (cm)", "kind": "number"},
                {"key": "notes", "label": "Notes", "kind": "text", "wrap": True},
            ],
            "fields": [
                {"key": "day", "label": "Day", "type": "date", "required": True},
                {"key": "member", "label": "Member", "type": "text"},
                {"key": "weightKg", "label": "Weight (kg)", "type": "number", "required": True, "placeholder": "72.4"},
                {"key": "waistCm", "label": "Waist (cm)", "type": "number"},
                {"key": "notes", "label": "Notes", "type": "textarea"},
            ],
        },
        "extraPages": [
            {
                "page_id": "goals", "title": "Goals", "resource": "weightGoals", "entity": ["goal", "goals"],
                "dsl": (
                    "goal:Goal|member:Member|startWeight:Start (kg)|targetWeight:Target (kg)|since:Since|status:Status"
                ),
                "columns": [
                    {"key": "goal", "label": "Goal", "kind": "text", "primary": True},
                    {
                        "key": "member", "label": "Member", "kind": "chip",
                        "tintBy": {"Me": "mint", "Partner": "pink", "Kid": "blue"},
                    },
                    {"key": "startWeight", "label": "Start (kg)", "kind": "number"},
                    {"key": "targetWeight", "label": "Target (kg)", "kind": "number"},
                    {"key": "since", "label": "Since", "kind": "date"},
                    {
                        "key": "status", "label": "Status", "kind": "chip",
                        "tintBy": {"Active": "green", "Reached": "mint", "Paused": "amber"},
                    },
                ],
                "fields": [
                    {"key": "goal", "label": "Goal", "type": "text", "required": True, "placeholder": "Back to 70 kg"},
                    {"key": "member", "label": "Member", "type": "text"},
                    {"key": "startWeight", "label": "Start (kg)", "type": "number"},
                    {"key": "targetWeight", "label": "Target (kg)", "type": "number"},
                    {"key": "since", "label": "Since", "type": "date"},
                    {"key": "status", "label": "Status", "type": "select", "options": ["Active", "Reached", "Paused"]},
                ],
                "rowActions": [
                    {
                        "id": "reached", "label": "Reached", "icon": "check", "quick": True, "kind": "patch",
                        "when": {"field": "status", "eq": "Active"}, "patch": {"status": "Reached"},
                        "toast": "Goal reached — congratulations.",
                    },
                ],
            },
        ],
        "extraTabs": [
            {"resource": "weightProfile", "dsl": "heightCm:Height (cm)", "rows": []},
            {
                "resource": "weightMembers", "dsl": "name:Name|relation:Relation|heightCm:Height (cm)",
                "rows": [{"id": "me", "name": "Me", "relation": "self", "heightCm": ""}],
            },
        ],
    },
    {
        "id": "plate", "name": "Plate", "tagline": "What you eat, written down", "icon": "utensils", "accent": "peach",
        "main": {
            "resource": "plateMeals", "entity": ["meal", "meals"],
            "dsl": "day:Day|meal:Meal|description:What you ate|calories:Calories",
            "columns": [
                {"key": "day", "label": "Day", "kind": "date"},
                {
                    "key": "meal", "label": "Meal", "kind": "chip",
                    "tintBy": {"Breakfast": "mint", "Lunch": "amber", "Dinner": "lavender", "Snack": "pink"},
                },
                {"key": "description", "label": "What you ate", "kind": "text", "primary": True, "wrap": True},
                {"key": "calories", "label": "Calories", "kind": "number"},
            ],
            "fields": [
                {"key": "day", "label": "Day", "type": "date", "required": True},
                {
                    "key": "meal", "label": "Meal", "type": "select",
                    "options": ["Breakfast", "Lunch", "Dinner", "Snack"], "required": True,
                },
                {
                    "key": "description", "label": "What you ate", "type": "textarea", "required": True,
                    "placeholder": "Eggs, toast, coffee…",
                },
                {"key": "calories", "label": "Calories", "type": "number"},
            ],
        },
        "extraTabs": [
            {
                "resource": "plateGuides", "dsl": "title:Title|subtitle:Subtitle|bullets:Bullets",
                "rows": WD_PLATE_GUIDES,
            },
        ],
    },
    {
        "id": "meds", "name": "Meds", "tagline": "Your medications, doses and leaflets", "icon": "pill",
        "accent": "blue",
        "main": {
            "resource": "medsList", "entity": ["medication", "medications"],
            "dsl": "name:Medication|dose:Dose|when:When|stock:Stock|leaflet:Leaflet (URL)|lastTaken:Last taken",
            "columns": [
                {"key": "name", "label": "Medication", "kind": "text", "primary": True},
                {"key": "dose", "label": "Dose", "kind": "text"},
                {"key": "when", "label": "When", "kind": "chips", "chipMax": 4},
                {"key": "stock", "label": "Stock", "kind": "number"},
                {"key": "leaflet", "label": "Leaflet (URL)", "kind": "text"},
                {"key": "lastTaken", "label": "Last taken", "kind": "date"},
            ],
            "fields": [
                {"key": "name", "label": "Medication", "type": "text", "required": True},
                {"key": "dose", "label": "Dose", "type": "text", "placeholder": "50 mg"},
                {"key": "when", "label": "When", "type": "text", "placeholder": "Morning, Night"},
                {"key": "stock", "label": "Stock", "type": "number"},
                {"key": "leaflet", "label": "Leaflet (URL)", "type": "text", "placeholder": "https://…"},
            ],
            "rowActions": [
                {
                    "id": "took-today", "label": "Took today", "icon": "check", "quick": True, "kind": "patch",
                    "patch": {"lastTaken": "{today}"}, "toast": "Marked as taken today.",
                },
                {
                    "id": "open-leaflet", "label": "Open leaflet", "icon": "external-link", "kind": "link",
                    "when": {"field": "leaflet", "neq": ""}, "href": "{row.leaflet}",
                },
            ],
        },
    },
    {
        "id": "doctors", "name": "Doctors", "tagline": "Appointments and the people who look after you",
        "icon": "stethoscope", "accent": "pink",
        "main": {
            "resource": "doctorVisits", "entity": ["appointment", "appointments"],
            "dsl": "day:Day|time:Time|doctor:Doctor|specialty:Specialty|place:Place|notes:Notes",
            "columns": [
                {"key": "day", "label": "Day", "kind": "date"}, {"key": "time", "label": "Time", "kind": "text"},
                {"key": "doctor", "label": "Doctor", "kind": "text", "primary": True},
                {
                    "key": "specialty", "label": "Specialty", "kind": "chip",
                    "tintBy": {
                        "Family medicine": "mint", "Cardiology": "pink", "Dental": "blue", "Vision": "lavender",
                        "Other": "amber",
                    },
                },
                {"key": "place", "label": "Place", "kind": "text"},
                {"key": "notes", "label": "Notes", "kind": "text", "wrap": True},
            ],
            "fields": [
                {"key": "day", "label": "Day", "type": "date", "required": True},
                {"key": "time", "label": "Time", "type": "text", "placeholder": "14:00"},
                {"key": "doctor", "label": "Doctor", "type": "text", "required": True},
                {
                    "key": "specialty", "label": "Specialty", "type": "select",
                    "options": ["Family medicine", "Cardiology", "Dental", "Vision", "Other"],
                },
                {"key": "place", "label": "Place", "type": "text"},
                {"key": "notes", "label": "Notes", "type": "textarea"},
            ],
        },
        "extraTabs": [
            {"resource": "doctorSpecialties", "dsl": "title:Title|subtitle:Subtitle", "rows": WD_DOCTOR_SPECIALTIES},
            {"resource": "doctorPrep", "dsl": "title:Title|subtitle:Subtitle|bullets:Bullets", "rows": WD_DOCTOR_PREP},
        ],
    },
    {
        "id": "vitals", "name": "Vitals", "tagline": "The numbers between doctor visits", "icon": "heart-pulse",
        "accent": "lavender",
        "main": {
            "resource": "vitalReadings", "entity": ["reading", "readings"],
            "dsl": "day:Day|kind:Kind|value:Reading|notes:Notes",
            "columns": [
                {"key": "day", "label": "Day", "kind": "date"},
                {
                    "key": "kind", "label": "Kind", "kind": "chip",
                    "tintBy": {
                        "Blood pressure": "pink", "Glucose": "amber", "Heart rate": "lavender", "Temperature": "blue",
                        "Oxygen": "mint",
                    },
                },
                {"key": "value", "label": "Reading", "kind": "text", "primary": True},
                {"key": "notes", "label": "Notes", "kind": "text", "wrap": True},
            ],
            "fields": [
                {"key": "day", "label": "Day", "type": "date", "required": True},
                {
                    "key": "kind", "label": "Kind", "type": "select",
                    "options": ["Blood pressure", "Glucose", "Heart rate", "Temperature", "Oxygen"], "required": True,
                },
                {"key": "value", "label": "Reading", "type": "text", "required": True, "placeholder": "120/80"},
                {"key": "notes", "label": "Notes", "type": "textarea"},
            ],
        },
        "extraTabs": [
            {
                "resource": "vitalRanges", "dsl": "title:Title|subtitle:Subtitle|bullets:Bullets",
                "rows": WD_VITAL_RANGES,
            },
        ],
    },
    {
        "id": "prices", "name": "Prices", "tagline": "Watch the price, buy at the low", "icon": "tag",
        "accent": "amber",
        "main": {
            "resource": "priceWatch", "entity": ["product", "products"],
            "dsl": "product:Product|store:Store|price:Price|url:Link|checked:Last checked|status:Status",
            "columns": [
                {"key": "product", "label": "Product", "kind": "text", "primary": True},
                {"key": "store", "label": "Store", "kind": "text"},
                {"key": "price", "label": "Price", "kind": "number"}, {"key": "url", "label": "Link", "kind": "text"},
                {"key": "checked", "label": "Last checked", "kind": "date"},
                {
                    "key": "status", "label": "Status", "kind": "chip",
                    "tintBy": {"Watching": "amber", "Bought": "mint", "Dropped": "pink"},
                },
            ],
            "fields": [
                {"key": "product", "label": "Product", "type": "text", "required": True},
                {"key": "store", "label": "Store", "type": "text"},
                {"key": "price", "label": "Price", "type": "number"},
                {"key": "url", "label": "Link", "type": "text", "placeholder": "https://…"},
                {"key": "checked", "label": "Last checked", "type": "date"},
                {"key": "status", "label": "Status", "type": "select", "options": ["Watching", "Bought", "Dropped"]},
            ],
            "rowActions": [
                {
                    "id": "checked-today", "label": "Checked today", "icon": "refresh-cw", "quick": True,
                    "kind": "patch", "patch": {"checked": "{today}"},
                },
                {
                    "id": "open-product", "label": "Open product", "icon": "external-link", "kind": "link",
                    "when": {"field": "url", "neq": ""}, "href": "{row.url}",
                },
                {
                    "id": "bought", "label": "Bought", "icon": "check", "kind": "patch",
                    "when": {"field": "status", "eq": "Watching"}, "patch": {"status": "Bought"},
                    "toast": "Bought — off the watchlist.",
                },
            ],
        },
    },
    {
        "id": "money", "name": "Finances", "tagline": "Your money, told in plain lines", "icon": "wallet",
        "accent": "green",
        "main": {
            "resource": "moneyMoves", "entity": ["entry", "entries"],
            "dsl": "day:Day|description:Description|category:Category|amount:Amount|direction:Direction",
            "columns": [
                {"key": "day", "label": "Day", "kind": "date"},
                {"key": "description", "label": "Description", "kind": "text", "primary": True, "wrap": True},
                {
                    "key": "category", "label": "Category", "kind": "chip",
                    "tintBy": {
                        "Housing": "blue", "Food": "peach", "Transport": "amber", "Health": "pink", "Fun": "lavender",
                        "Other": "mint",
                    },
                },
                {"key": "amount", "label": "Amount", "kind": "number"},
                {"key": "direction", "label": "Direction", "kind": "chip", "tintBy": {"In": "mint", "Out": "pink"}},
            ],
            "fields": [
                {"key": "day", "label": "Day", "type": "date", "required": True},
                {
                    "key": "description", "label": "Description", "type": "text", "required": True,
                    "placeholder": "Groceries",
                },
                {
                    "key": "category", "label": "Category", "type": "select",
                    "options": ["Housing", "Food", "Transport", "Health", "Fun", "Other"],
                },
                {"key": "amount", "label": "Amount", "type": "number", "required": True},
                {
                    "key": "direction", "label": "Direction", "type": "select", "options": ["In", "Out"],
                    "required": True,
                },
            ],
        },
        "extraPages": [
            {
                "page_id": "bills", "title": "Recurring bills", "resource": "moneyBills", "entity": ["bill", "bills"],
                "dsl": "name:Bill|amount:Amount|dueDay:Due day|autopay:Autopay|lastPaid:Last paid",
                "columns": [
                    {"key": "name", "label": "Bill", "kind": "text", "primary": True},
                    {"key": "amount", "label": "Amount", "kind": "number"},
                    {"key": "dueDay", "label": "Due day", "kind": "number"},
                    {"key": "autopay", "label": "Autopay", "kind": "chip", "tintBy": {"Yes": "mint", "No": "amber"}},
                    {"key": "lastPaid", "label": "Last paid", "kind": "date"},
                ],
                "fields": [
                    {"key": "name", "label": "Bill", "type": "text", "required": True, "placeholder": "Electricity"},
                    {"key": "amount", "label": "Amount", "type": "number", "required": True},
                    {"key": "dueDay", "label": "Due day", "type": "number", "placeholder": "15"},
                    {"key": "autopay", "label": "Autopay", "type": "select", "options": ["Yes", "No"]},
                    {"key": "lastPaid", "label": "Last paid", "type": "date"},
                ],
                "rowActions": [
                    {
                        "id": "mark-paid", "label": "Mark paid", "icon": "check", "quick": True, "kind": "patch",
                        "patch": {"lastPaid": "{today}"}, "toast": "Paid — see you next month.",
                    },
                ],
            },
        ],
    },
    {
        "id": "habits", "name": "Habits", "tagline": "Small things, every day", "icon": "repeat", "accent": "lavender",
        "main": {
            "resource": "habitsLog", "entity": ["entry", "entries"],
            "dsl": "day:Day|habit:Habit|done:Status|notes:Notes",
            "columns": [
                {"key": "day", "label": "Day", "kind": "date"},
                {"key": "habit", "label": "Habit", "kind": "text", "primary": True},
                {
                    "key": "done", "label": "Status", "kind": "chip",
                    "tintBy": {"Done": "mint", "Planned": "amber", "Skipped": "pink"},
                },
                {"key": "notes", "label": "Notes", "kind": "text", "wrap": True},
            ],
            "fields": [
                {"key": "day", "label": "Day", "type": "date", "required": True},
                {"key": "habit", "label": "Habit", "type": "text", "required": True, "placeholder": "Read 20 minutes"},
                {"key": "done", "label": "Status", "type": "select", "options": ["Planned", "Done", "Skipped"]},
                {"key": "notes", "label": "Notes", "type": "textarea"},
            ],
            "rowActions": [
                {
                    "id": "mark-done", "label": "Mark done", "icon": "check", "quick": True, "kind": "patch",
                    "when": {"field": "done", "neq": "Done"}, "patch": {"done": "Done"},
                    "toast": "Done — one more day.",
                },
            ],
        },
    },
    {
        "id": "home", "name": "Home", "tagline": "The pantry and the fixes", "icon": "home", "accent": "blue",
        "main": {
            "resource": "homePantry", "entity": ["item", "items"],
            "dsl": "item:Item|qty:Qty|expires:Expires|notes:Notes",
            "columns": [
                {"key": "item", "label": "Item", "kind": "text", "primary": True},
                {"key": "qty", "label": "Qty", "kind": "number"},
                {"key": "expires", "label": "Expires", "kind": "date", "expiry": True},
                {"key": "notes", "label": "Notes", "kind": "text", "wrap": True},
            ],
            "fields": [
                {"key": "item", "label": "Item", "type": "text", "required": True},
                {"key": "qty", "label": "Qty", "type": "number"},
                {"key": "expires", "label": "Expires", "type": "date"},
                {"key": "notes", "label": "Notes", "type": "textarea"},
            ],
        },
    },
    {
        "id": "pets", "name": "Pets", "tagline": "Shots, vets and the little ones", "icon": "paw-print",
        "accent": "peach",
        "main": {
            "resource": "petsList", "entity": ["pet", "pets"],
            "dsl": "name:Name|species:Species|breed:Breed|vetPhone:Vet phone|notes:Notes",
            "columns": [
                {"key": "name", "label": "Name", "kind": "text", "primary": True},
                {
                    "key": "species", "label": "Species", "kind": "chip",
                    "tintBy": {"Dog": "mint", "Cat": "lavender", "Bird": "blue", "Other": "amber"},
                },
                {"key": "breed", "label": "Breed", "kind": "text"},
                {"key": "vetPhone", "label": "Vet phone", "kind": "text", "icon": "phone"},
                {"key": "notes", "label": "Notes", "kind": "text", "wrap": True},
            ],
            "fields": [
                {"key": "name", "label": "Name", "type": "text", "required": True},
                {"key": "species", "label": "Species", "type": "select", "options": ["Dog", "Cat", "Bird", "Other"]},
                {"key": "breed", "label": "Breed", "type": "text"},
                {"key": "vetPhone", "label": "Vet phone", "type": "text", "placeholder": "+1…"},
                {"key": "notes", "label": "Notes", "type": "textarea"},
            ],
            "rowActions": [
                {
                    "id": "call-vet", "label": "Call vet", "icon": "phone", "quick": True, "kind": "link",
                    "when": {"field": "vetPhone", "neq": ""}, "href": "tel:{row.vetPhone}",
                },
            ],
        },
        "extraPages": [
            {
                "page_id": "shots", "title": "Vaccines", "resource": "petShots", "entity": ["vaccine", "vaccines"],
                "dsl": "pet:Pet|vaccine:Vaccine|given:Given|nextDue:Next due",
                "columns": [
                    {"key": "pet", "label": "Pet", "kind": "text", "primary": True},
                    {"key": "vaccine", "label": "Vaccine", "kind": "text"},
                    {"key": "given", "label": "Given", "kind": "date"},
                    {"key": "nextDue", "label": "Next due", "kind": "date", "expiry": True},
                ],
                "fields": [
                    {"key": "pet", "label": "Pet", "type": "text", "required": True},
                    {"key": "vaccine", "label": "Vaccine", "type": "text", "required": True, "placeholder": "Rabies"},
                    {"key": "given", "label": "Given", "type": "date"},
                    {"key": "nextDue", "label": "Next due", "type": "date"},
                ],
            },
        ],
        "extraTabs": [
            {"resource": "petGuides", "dsl": "title:Title|subtitle:Subtitle|bullets:Bullets", "rows": WD_PET_GUIDES},
        ],
    },
    {
        "id": "vault", "name": "Vault", "tagline": "Your documents, one tap away", "icon": "folder-lock",
        "accent": "amber",
        "main": {
            "resource": "vaultDocs", "entity": ["document", "documents"],
            "dsl": "title:Document|kind:Kind|url:Link|updated:Updated|notes:Notes",
            "columns": [
                {"key": "title", "label": "Document", "kind": "text", "primary": True},
                {
                    "key": "kind", "label": "Kind", "kind": "chip",
                    "tintBy": {
                        "ID": "blue", "Insurance": "mint", "Health": "pink", "Money": "amber", "Home": "lavender",
                        "Other": "peach",
                    },
                },
                {"key": "url", "label": "Link", "kind": "text"}, {"key": "updated", "label": "Updated", "kind": "date"},
                {"key": "notes", "label": "Notes", "kind": "text", "wrap": True},
            ],
            "fields": [
                {"key": "title", "label": "Document", "type": "text", "required": True, "placeholder": "Passport"},
                {
                    "key": "kind", "label": "Kind", "type": "select",
                    "options": ["ID", "Insurance", "Health", "Money", "Home", "Other"],
                },
                {"key": "url", "label": "Link", "type": "text", "placeholder": "https://drive.google.com/…"},
                {"key": "updated", "label": "Updated", "type": "date"},
                {"key": "notes", "label": "Notes", "type": "textarea"},
            ],
            "rowActions": [
                {
                    "id": "touch-today", "label": "Updated today", "icon": "refresh-cw", "quick": True, "kind": "patch",
                    "patch": {"updated": "{today}"},
                },
                {
                    "id": "open-doc", "label": "Open", "icon": "external-link", "kind": "link",
                    "when": {"field": "url", "neq": ""}, "href": "{row.url}",
                },
            ],
        },
    },
]
