// Questionnaires seed (questionnaire-suite wave) — the Q&A engine's data.
// Two datasets, consumed directly by the Questionnaires feature pages (src/pages/features/questionnaire/) and…
import { subHours } from 'date-fns'
import { withTenant } from '@/lib/tenancy'

const now = new Date()
const iso = (d: Date) => d.toISOString()

/* ---------------- types ---------------- */

// The kinds a question can be.
export type QuestionKind = 'choice' | 'text' | 'scale' | 'number' | 'yesno' | 'date'

// What an answer is worth, in the source's own vocabulary.
export type QuestionScoring = {
  metric: string
  weight: number
  /** Which answer is the good one. Absent on kinds where it means nothing. */
  yesIs?: 'yes' | 'no'
  /** The sheet's "Purpose / Interpretation", kept for the person reading it. */
  purpose: string
}

/** The 5 runner header layouts (admin-customizable per questionnaire). */
export type HeaderLayout = 'hero' | 'split' | 'banner' | 'minimal' | 'cards'

export type QuestionnaireAudience = 'new-hire' | 'all-staff' | 'manager'

export type QuestionOption = { key: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'; text: string }

export type QuestionnaireQuestion = {
  id: string
  kind: QuestionKind
  /** The tinted quote-box text ("Read each scenario…" card body). */
  scenario: string
  /** The bold question under the scenario. */
  prompt: string
  /** choice only — 2–6 lettered options (A–F; seeded questions use 4). */
  options?: QuestionOption[]
  // written only — the grey hint inside the box, per question.
  placeholder?: string
  /** scale only — the ends of the 1–5 ladder, in words. */
  scaleLabels?: [string, string]
  /** number only — what is being counted, shown beside the field. */
  unit?: string
  // Present on measured questions; absent on the scenario cards, which are read by a person and scored by nobody.
  scoring?: QuestionScoring
  required: boolean
}

export type Questionnaire = {
  id: string
  title: string
  description: string
  audience: QuestionnaireAudience
  estimatedMin: number
  privacyNote: string
  headerLayout: HeaderLayout
  questions: QuestionnaireQuestion[]
}

export type ResponseRole = 'candidate' | 'staff' | 'manager'

/** One captured answer: the picked letter for choice questions, the written text for free-text ones. */
export type ResponseAnswer = {
  questionId: string
  choiceKey?: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
  text?: string
}

export type QuestionnaireResponse = {
  id: string
  questionnaireId: string
  respondentName: string
  role: ResponseRole
  submittedAt: string // ISO
  answersSummary: string // e.g. "5/5 answered"
  /** Structured per-question answers (older responses may lack them → summary-only). */
  answers?: ResponseAnswer[]
  score?: number | null
  status: 'submitted' | 'reviewed'
}

/* ---------------- questionnaires (3) ---------------- */

// Bump when the SEEDED questions change.
export const QUESTIONNAIRE_SEED_VERSION = 3

/** Whose seeded questions changed in this version — only these lose a local edit. */
export const RESEEDED_QUESTIONNAIRE_IDS = [
  'q-caregiving-instincts',
  'q-skills-enhancement', 'q-compliance-training', 'q-mentorship-life-planning',
]

export const questionnaires = withTenant<Questionnaire>([
  {
    id: 'q-caregiving-instincts',
    title: 'Caregiving Instincts — New Hire Questionnaire',
    description:
      'Read each scenario and respond honestly. The first three are multiple choice; the last two ask for your own words. There are no wrong answers — we want to understand your caregiving instincts.',
    audience: 'new-hire',
    estimatedMin: 5,
    privacyNote: 'Visible to your team only',
    headerLayout: 'hero',
    questions: [
      {
        id: 'q1-transition',
        kind: 'choice',
        scenario:
          'A client with autism becomes very agitated during a routine transition between activities. They begin pacing rapidly and raising their voice.',
        prompt: 'What is your first response?',
        options: [
          { key: 'A', text: 'Calmly acknowledge their feelings and offer a quiet space to decompress before continuing.' },
          { key: 'B', text: 'Redirect them to a preferred activity they enjoy to help them self-regulate.' },
          { key: 'C', text: 'Give clear, simple instructions to guide them through the transition step by step.' },
          { key: 'D', text: 'Step back and give them physical space while staying nearby for safety.' },
        ],
        required: true,
      },
      {
        id: 'q2-meals',
        kind: 'choice',
        scenario:
          'You arrive for your shift and the outgoing caregiver tells you the client has been refusing meals all day and seems withdrawn.',
        prompt: 'How do you approach the situation?',
        options: [
          { key: 'A', text: 'Sit with the client and gently ask open-ended questions about how they’re feeling.' },
          { key: 'B', text: 'Offer a small, favorite snack in a low-pressure way and observe their mood.' },
          { key: 'C', text: 'Document the behavior and immediately contact the supervisor for guidance.' },
          { key: 'D', text: 'Engage them in a familiar activity first, then try introducing food later.' },
        ],
        required: true,
      },
      {
        id: 'q3-family',
        kind: 'choice',
        scenario:
          'A client’s family member arrives during your shift and begins criticizing the care plan, saying "this isn’t what we agreed to."',
        prompt: 'What do you do?',
        options: [
          { key: 'A', text: 'Listen respectfully, acknowledge their concerns, and explain you’ll pass the feedback to your supervisor.' },
          { key: 'B', text: 'Show them the documented care plan and walk through what you’ve been doing.' },
          { key: 'C', text: 'Politely let them know you follow the plan as written and suggest they contact the office.' },
          { key: 'D', text: 'Ask them what specific changes they’d like to see and take notes to share with the team.' },
        ],
        required: true,
      },
      {
        id: 'q4-medication-documentation',
        kind: 'text',
        scenario:
          'You notice a coworker on the previous shift has been consistently skipping a client’s evening medication documentation.',
        prompt: 'How do you handle this? Describe what you would do and why.',
        placeholder: 'Explain your approach…',
        required: true,
      },
      {
        id: 'q5-nonverbal-discomfort',
        kind: 'text',
        scenario:
          'A non-verbal client is showing signs of discomfort — grimacing, pulling at their clothing, and refusing to sit down — but you can’t identify the cause.',
        prompt: 'Walk us through your thought process and the steps you would take.',
        placeholder: 'Describe how you would assess and respond to this situation…',
        required: true,
      },
    ]
  },
  {
    id: 'q-dodd-knowledge',
    title: 'DODD Knowledge Check',
    description:
      'Four quick questions on the Ohio DODD rules that shape daily care — MUI reporting, ISPs, medication administration and client rights. Choose the best answer for each.',
    audience: 'all-staff',
    estimatedMin: 6,
    privacyNote: 'Visible to your team only',
    headerLayout: 'split',
    questions: [
      {
        id: 'q2-mui',
        kind: 'choice',
        scenario:
          'During your shift, a client falls and is taken to the emergency room. Your supervisor mentions this may need to be reported to the county board as a Major Unusual Incident (MUI).',
        prompt: 'Under DODD rules, when must an MUI be reported?',
        options: [
          { key: 'A', text: 'Immediately, and no later than the next business day' },
          { key: 'B', text: 'Within one week of the incident' },
          { key: 'C', text: "Only at the client's annual review" },
          { key: 'D', text: 'Only if the family requests a report' },
        ],
        required: true,
      },
      {
        id: 'q2-isp',
        kind: 'choice',
        scenario:
          'Every client served under a DODD waiver has an Individual Service Plan (ISP) that guides their goals, supports and daily care.',
        prompt: 'How often is the ISP formally reviewed and updated?',
        options: [
          { key: 'A', text: 'Only when a client moves to a new house' },
          { key: 'B', text: "At least once every 12 months — and whenever the client's needs change" },
          { key: 'C', text: 'Every week at team meetings' },
          { key: 'D', text: 'Once, at intake — it never changes after that' },
        ],
        required: true,
      },
      {
        id: 'q2-meds',
        kind: 'choice',
        scenario:
          "A coworker asks you to give a client their morning medications, but you have not completed DODD medication administration certification.",
        prompt: 'What is the correct action?',
        options: [
          { key: 'A', text: 'Give the medications anyway — a coworker vouched for you' },
          { key: 'B', text: 'Politely decline and explain that only certified staff may administer medications' },
          { key: 'C', text: 'Give half the dose to be safe' },
          { key: 'D', text: "Crush the medication into the client's food so it's easier" },
        ],
        required: true,
      },
      {
        id: 'q2-rights',
        kind: 'choice',
        scenario:
          'DODD rules guarantee the rights of individuals with developmental disabilities — including dignity, privacy, and freedom of choice in daily life.',
        prompt: 'Which of these best honors client rights during daily care?',
        options: [
          { key: 'A', text: 'Making all decisions for clients to keep the house running efficiently' },
          { key: 'B', text: 'Offering real choices (clothing, meals, activities) and respecting refusals whenever safely possible' },
          { key: 'C', text: "Discussing a client's diagnosis with neighbors so they understand the situation" },
          { key: 'D', text: 'Restricting visitors to reduce disruptions to the routine' },
        ],
        required: true,
      },
    ],
  },
  {
    id: 'q-manager-scenarios',
    title: 'Manager Scenario Review',
    description:
      'Three open-ended leadership scenarios from real house operations. Answer in your own words — we are looking at judgment, prioritization and how you communicate under pressure.',
    audience: 'manager',
    estimatedMin: 10,
    privacyNote: 'Visible to the leadership team only',
    headerLayout: 'banner',
    questions: [
      {
        id: 'q3-calloff',
        kind: 'text',
        scenario:
          'Two caregivers call off for the same weekend shift at a house with four clients who require 2:1 staffing at all times. Your on-call list is thin and one client has a community outing planned.',
        prompt: 'How do you cover the shift, and in what order do you make your calls?',
        required: true,
      },
      {
        id: 'q3-performance',
        kind: 'text',
        scenario:
          'A caregiver is consistently 20 minutes late and her documentation has started slipping — but clients adore her and she is one of your strongest hands-on workers.',
        prompt: 'How do you handle the conversation? What do you say first, and what do you put in writing?',
        required: true,
      },
      {
        id: 'q3-family',
        kind: 'text',
        scenario:
          "A client's mother calls upset that her son's ISP goals \"aren't being worked on\" and threatens to escalate to the county board if she doesn't see change this month.",
        prompt: 'Describe your response — both to the mother in the moment, and internally with your team afterwards.',
        required: true,
      },
    ],
  },
  {
    id: 'q-skills-enhancement',
    title: "Skills Enhancement \u2014 Individual Evaluation",
    description: "Ten questions on the training you have taken this quarter and what you got out of it. Answers feed the Skills Enhancement metrics; the last one is open text and is read, not scored.",
    audience: 'all-staff',
    estimatedMin: 8,
    privacyNote: 'Visible to your team only',
    headerLayout: 'minimal',
    questions: [
      {
        id: 'q-skills-enhancement-q1',
        kind: 'number',
        prompt: "How many elective or optional trainings have you completed this quarter?",
        scenario: "Measures initiative for self-directed learning.",
        unit: "count",
        scoring: { metric: "VoluntaryTraining%", weight: 0.25, purpose: "Measures initiative for self-directed learning." },
        required: true,
      },
      {
        id: 'q-skills-enhancement-q2',
        kind: 'scale',
        prompt: "Do you feel that your skills have improved since your last evaluation?",
        scenario: "Employee self-perceived growth (cross-validated with supervisor skill assessment).",
        scaleLabels: ["Not at all", "A great deal"],
        scoring: { metric: "SkillImprovement%", weight: 0.25, purpose: "Employee self-perceived growth (cross-validated with supervisor skill assessment)." },
        required: true,
      },
      {
        id: 'q-skills-enhancement-q3',
        kind: 'scale',
        prompt: "How confident are you in applying the new skills you learned to your daily work?",
        scenario: "Tracks skill transfer and retention.",
        scaleLabels: ["Not at all", "Completely"],
        scoring: { metric: "SkillImprovement%", weight: 0.25, purpose: "Tracks skill transfer and retention." },
        required: true,
      },
      {
        id: 'q-skills-enhancement-q4',
        kind: 'yesno',
        prompt: "Have you participated in any cross-training with other sites or client types?",
        scenario: "Captures flexibility and inter-team learning.",
        scoring: { metric: "CrossTraining%", weight: 0.2, yesIs: "yes", purpose: "Captures flexibility and inter-team learning." },
        required: true,
      },
      {
        id: 'q-skills-enhancement-q5',
        kind: 'scale',
        prompt: "How would you rate the usefulness of your most recent training?",
        scenario: "Measures practical impact and engagement.",
        scaleLabels: ["Not at all", "A great deal"],
        scoring: { metric: "EvaluationScore", weight: 0.15, purpose: "Measures practical impact and engagement." },
        required: true,
      },
      {
        id: 'q-skills-enhancement-q6',
        kind: 'scale',
        prompt: "How often do you discuss new techniques or lessons learned with peers?",
        scenario: "Gauges peer knowledge sharing.",
        scaleLabels: ["Never", "Always"],
        scoring: { metric: "VoluntaryTraining%", weight: 0.25, purpose: "Gauges peer knowledge sharing." },
        required: true,
      },
      {
        id: 'q-skills-enhancement-q7',
        kind: 'number',
        prompt: "Total estimated training hours completed this quarter (approximate).",
        scenario: "Tracks learning engagement and time investment.",
        unit: "hours",
        scoring: { metric: "TrainingHoursPerFTE", weight: 0.15, purpose: "Tracks learning engagement and time investment." },
        required: true,
      },
      {
        id: 'q-skills-enhancement-q8',
        kind: 'scale',
        prompt: "Has your supervisor observed noticeable improvement in your work since recent training?",
        scenario: "Cross-verifies objective growth.",
        scaleLabels: ["Not at all", "A great deal"],
        scoring: { metric: "SkillImprovement%", weight: 0.25, purpose: "Cross-verifies objective growth." },
        required: true,
      },
      {
        id: 'q-skills-enhancement-q9',
        kind: 'scale',
        prompt: "How often do you seek feedback or coaching after training sessions?",
        scenario: "Indicates continuous improvement behavior.",
        scaleLabels: ["Never", "Always"],
        scoring: { metric: "VoluntaryTraining%", weight: 0.25, purpose: "Indicates continuous improvement behavior." },
        required: true,
      },
      {
        id: 'q-skills-enhancement-q10',
        kind: 'text',
        prompt: "What training areas do you feel least confident in?",
        scenario: "AI uses this for skill gap prediction.",
        placeholder: 'In your own words — this one is read by a person, not scored.',
        required: true,
      },
    ],
  },
  {
    id: 'q-compliance-training',
    title: "Compliance Training \u2014 Individual Evaluation",
    description: "Ten questions on mandatory training, certifications and renewals. Answers feed the Compliance metrics; the last one is open text and is read, not scored.",
    audience: 'all-staff',
    estimatedMin: 8,
    privacyNote: 'Visible to your team only',
    headerLayout: 'minimal',
    questions: [
      {
        id: 'q-compliance-training-q1',
        kind: 'yesno',
        prompt: "Did you complete all mandatory trainings before their due dates this quarter?",
        scenario: "Tracks timeliness.",
        scoring: { metric: "OnTimeCompletion%", weight: 0.25, yesIs: "yes", purpose: "Tracks timeliness." },
        required: true,
      },
      {
        id: 'q-compliance-training-q2',
        kind: 'yesno',
        prompt: "Were you reminded or contacted by HR about overdue training?",
        scenario: "Evaluates compliance independence.",
        scoring: { metric: "RetrainingOverdueInverse", weight: 0.15, yesIs: "yes", purpose: "Evaluates compliance independence." },
        required: true,
      },
      {
        id: 'q-compliance-training-q3',
        kind: 'date',
        prompt: "When was the last time you renewed your certification (CPR, Med Del, etc.)?",
        scenario: "Feeds into compliance tracking.",
        scoring: { metric: "CertRenewal%", weight: 0.25, purpose: "Feeds into compliance tracking." },
        required: true,
      },
      {
        id: 'q-compliance-training-q4',
        kind: 'number',
        prompt: "Average quiz score from most recent compliance modules.",
        scenario: "Measures comprehension.",
        unit: "%",
        scoring: { metric: "QuizAccuracy%", weight: 0.2, purpose: "Measures comprehension." },
        required: true,
      },
      {
        id: 'q-compliance-training-q5',
        kind: 'scale',
        prompt: "Do you understand how each compliance course applies to your role?",
        scenario: "Qualitative understanding check.",
        scaleLabels: ["Never", "Always"],
        scoring: { metric: "QuizAccuracy%", weight: 0.2, purpose: "Qualitative understanding check." },
        required: true,
      },
      {
        id: 'q-compliance-training-q6',
        kind: 'yesno',
        prompt: "Did you complete onboarding or recertification within required timeframe?",
        scenario: "Tracks efficiency and engagement.",
        scoring: { metric: "OnboardingCompletion%", weight: 0.15, yesIs: "yes", purpose: "Tracks efficiency and engagement." },
        required: true,
      },
      {
        id: 'q-compliance-training-q7',
        kind: 'yesno',
        prompt: "Have you ever had an expired certification while working?",
        scenario: "Risk flag for compliance.",
        scoring: { metric: "CertRenewal%", weight: 0.25, yesIs: "no", purpose: "Risk flag for compliance." },
        required: true,
      },
      {
        id: 'q-compliance-training-q8',
        kind: 'scale',
        prompt: "How confident do you feel about meeting upcoming compliance deadlines?",
        scenario: "Predictive confidence measure.",
        scaleLabels: ["Not at all", "Completely"],
        scoring: { metric: "OnTimeCompletion%", weight: 0.25, purpose: "Predictive confidence measure." },
        required: true,
      },
      {
        id: 'q-compliance-training-q9',
        kind: 'yesno',
        prompt: "Have you requested clarification or help understanding compliance content?",
        scenario: "Indicates self-sufficiency.",
        scoring: { metric: "QuizAccuracy%", weight: 0.2, yesIs: "yes", purpose: "Indicates self-sufficiency." },
        required: true,
      },
      {
        id: 'q-compliance-training-q10',
        kind: 'text',
        prompt: "Which compliance course do you find least relevant or engaging?",
        scenario: "Improves future course design.",
        placeholder: 'In your own words — this one is read by a person, not scored.',
        required: true,
      },
    ],
  },
  {
    id: 'q-mentorship-life-planning',
    title: "Mentorship & Life Planning \u2014 Individual Evaluation",
    description: "Ten questions on mentorship, career planning and how the work is sitting with you. Answers feed the Mentorship metrics; the last one is open text and is read, not scored.",
    audience: 'all-staff',
    estimatedMin: 10,
    privacyNote: 'Visible to your team only',
    headerLayout: 'minimal',
    questions: [
      {
        id: 'q-mentorship-life-planning-q1',
        kind: 'yesno',
        prompt: "Are you currently paired with a mentor or coach?",
        scenario: "Tracks mentorship coverage.",
        scoring: { metric: "MentorshipReach%", weight: 0.2, yesIs: "yes", purpose: "Tracks mentorship coverage." },
        required: true,
      },
      {
        id: 'q-mentorship-life-planning-q2',
        kind: 'scale',
        prompt: "How often do you meet or communicate with your mentor?",
        scenario: "Frequency = engagement indicator.",
        scaleLabels: ["Never", "Always"],
        scoring: { metric: "MentorshipReach%", weight: 0.2, purpose: "Frequency = engagement indicator." },
        required: true,
      },
      {
        id: 'q-mentorship-life-planning-q3',
        kind: 'scale',
        prompt: "How satisfied are you with your mentorship relationship overall?",
        scenario: "Evaluates mentor effectiveness.",
        scaleLabels: ["Not at all", "Completely"],
        scoring: { metric: "MenteeSatisfaction", weight: 0.2, purpose: "Evaluates mentor effectiveness." },
        required: true,
      },
      {
        id: 'q-mentorship-life-planning-q4',
        kind: 'scale',
        prompt: "Has mentorship helped you set clearer career or life goals?",
        scenario: "Links mentorship to growth planning.",
        scaleLabels: ["Never", "Always"],
        scoring: { metric: "CareerPlanCompletion%", weight: 0.2, purpose: "Links mentorship to growth planning." },
        required: true,
      },
      {
        id: 'q-mentorship-life-planning-q5',
        kind: 'yesno',
        prompt: "Have you updated your career development plan in the last 6 months?",
        scenario: "Tracks career planning discipline.",
        scoring: { metric: "CareerPlanCompletion%", weight: 0.2, yesIs: "yes", purpose: "Tracks career planning discipline." },
        required: true,
      },
      {
        id: 'q-mentorship-life-planning-q6',
        kind: 'scale',
        prompt: "Do you feel your mentor supports your work-life balance?",
        scenario: "Monitors well-being outcomes.",
        scaleLabels: ["Never", "Always"],
        scoring: { metric: "LifeBalanceImprovement%", weight: 0.2, purpose: "Monitors well-being outcomes." },
        required: true,
      },
      {
        id: 'q-mentorship-life-planning-q7',
        kind: 'scale',
        prompt: "How confident do you feel about your long-term growth in this company?",
        scenario: "Measures developmental retention predictor.",
        scaleLabels: ["Not at all", "Completely"],
        scoring: { metric: "RetentionMentored%", weight: 0.2, purpose: "Measures developmental retention predictor." },
        required: true,
      },
      {
        id: 'q-mentorship-life-planning-q8',
        kind: 'yesno',
        prompt: "Have you mentored or coached others recently?",
        scenario: "Tracks cultural diffusion of mentorship.",
        scoring: { metric: "MentorshipReach%", weight: 0.2, yesIs: "yes", purpose: "Tracks cultural diffusion of mentorship." },
        required: true,
      },
      {
        id: 'q-mentorship-life-planning-q9',
        kind: 'scale',
        prompt: "Have you noticed any improvements in your mood, motivation, or focus since mentorship began?",
        scenario: "Monitors holistic growth outcomes.",
        scaleLabels: ["Not at all", "A great deal"],
        scoring: { metric: "LifeBalanceImprovement%", weight: 0.2, purpose: "Monitors holistic growth outcomes." },
        required: true,
      },
      {
        id: 'q-mentorship-life-planning-q10',
        kind: 'text',
        prompt: "What support would help you progress toward your career goals?",
        scenario: "Feeds AI suggestion layer.",
        placeholder: 'In your own words — this one is read by a person, not scored.',
        required: true,
      },
    ],
  },
])

/* ---------------- questionnaire responses ---------------- */

// ONE RESPONDENT, AND THAT RESPONDENT IS REAL.
const OPERATOR_NAME = 'asatech'

export const questionnaireResponses = withTenant<QuestionnaireResponse>([
  {
    id: 'qr-asatech-skills-enhancement',
    questionnaireId: 'q-skills-enhancement',
    respondentName: OPERATOR_NAME,
    role: 'staff',
    submittedAt: iso(subHours(now, 2)),
    answersSummary: '10/10 answered',
    answers: [
      { questionId: 'q-skills-enhancement-q1', text: "4" },
      { questionId: 'q-skills-enhancement-q2', text: "5" },
      { questionId: 'q-skills-enhancement-q3', text: "5" },
      { questionId: 'q-skills-enhancement-q4', text: "Yes" },
      { questionId: 'q-skills-enhancement-q5', text: "5" },
      { questionId: 'q-skills-enhancement-q6', text: "5" },
      { questionId: 'q-skills-enhancement-q7', text: "18" },
      { questionId: 'q-skills-enhancement-q8', text: "5" },
      { questionId: 'q-skills-enhancement-q9', text: "5" },
      { questionId: 'q-skills-enhancement-q10', text: "\u2014" },
    ],
    score: 5,
    status: 'reviewed',
  },
  {
    id: 'qr-asatech-compliance-training',
    questionnaireId: 'q-compliance-training',
    respondentName: OPERATOR_NAME,
    role: 'staff',
    submittedAt: iso(subHours(now, 5)),
    answersSummary: '10/10 answered',
    answers: [
      { questionId: 'q-compliance-training-q1', text: "Yes" },
      { questionId: 'q-compliance-training-q2', text: "Yes" },
      { questionId: 'q-compliance-training-q3', text: "2026-06-15" },
      { questionId: 'q-compliance-training-q4', text: "95" },
      { questionId: 'q-compliance-training-q5', text: "5" },
      { questionId: 'q-compliance-training-q6', text: "Yes" },
      { questionId: 'q-compliance-training-q7', text: "Yes" },
      { questionId: 'q-compliance-training-q8', text: "5" },
      { questionId: 'q-compliance-training-q9', text: "Yes" },
      { questionId: 'q-compliance-training-q10', text: "\u2014" },
    ],
    score: 5,
    status: 'reviewed',
  },
  {
    id: 'qr-asatech-mentorship-life-planning',
    questionnaireId: 'q-mentorship-life-planning',
    respondentName: OPERATOR_NAME,
    role: 'staff',
    submittedAt: iso(subHours(now, 8)),
    answersSummary: '10/10 answered',
    answers: [
      { questionId: 'q-mentorship-life-planning-q1', text: "Yes" },
      { questionId: 'q-mentorship-life-planning-q2', text: "5" },
      { questionId: 'q-mentorship-life-planning-q3', text: "5" },
      { questionId: 'q-mentorship-life-planning-q4', text: "5" },
      { questionId: 'q-mentorship-life-planning-q5', text: "Yes" },
      { questionId: 'q-mentorship-life-planning-q6', text: "5" },
      { questionId: 'q-mentorship-life-planning-q7', text: "5" },
      { questionId: 'q-mentorship-life-planning-q8', text: "Yes" },
      { questionId: 'q-mentorship-life-planning-q9', text: "5" },
      { questionId: 'q-mentorship-life-planning-q10', text: "\u2014" },
    ],
    score: 5,
    status: 'reviewed',
  },
])
