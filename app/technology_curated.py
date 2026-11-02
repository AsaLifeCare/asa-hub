"""Technology's curated layer (server/technology_slices.py, moved whole): the engineering assessment and the per-project
assessment the Technology screen shows beside what the folder and the tables hold. Text, not data the screen writes."""
from __future__ import annotations

# provenance of the curated layer ported below
ASSESSMENT_VERSION = "2026-06-22"
AUDIT_DATE = "2026-06-10"      # source deep architecture audit (docs/arch-analysis/)
VERIFIED_DATE = "2026-06-22"   # date the gap statuses were re-checked vs live code

STATE_PARAGRAPH = (
    "The platform is architecturally coherent and demonstrably autonomous-capable: "
    "the cortex has shipped a feature end-to-end through detect → generate → repair → "
    "sandbox → unanimous council → canary → promote. The knowledge read-path is fully "
    "deterministic (zero LLM tokens), runtime state is mostly Redis-shared across the two "
    "serving replicas, and the safety rails (gates, councils, caps, panic-brake, auto-re-arm) "
    "are real — not theatrical. The dominant remaining defect classes are silent wiring "
    "breaks (jobs/events/fields with no consumer), per-replica state that quietly diverges, "
    "and observability that displays without truly observing."
)

FIGURES: list[dict[str, str]] = [
    {"label": "Cortex modules", "value": "181", "hint": "cortex_*.py cognitive modules"},
    {"label": "API routes", "value": "1,139", "hint": "FastAPI endpoints in main.py"},
    {"label": "main.py", "value": "65.9K", "hint": "lines in one file — monolith (debt)"},
    {"label": "Analytics modules", "value": "370", "hint": "app/analytics/*.py"},
    {"label": "Python LOC", "value": "~461K", "hint": "app/ total"},
    {"label": "Data tables", "value": "~128", "hint": "Postgres (06-10 audit)"},
    {"label": "LLM providers", "value": "18", "hint": "ProviderRouter / vault, with fallback"},
    {"label": "Serving", "value": "2 replicas", "hint": "+ leader + nginx, zero-downtime deploy"},
]

STRENGTHS: list[dict[str, str]] = [
    {
        "title": "Deterministic knowledge read-path",
        "detail": "Drive → OCR → full-text search → synthesis → facts → profile resolves with "
                  "zero LLM tokens on the read side. The in-house stack fully replaced Memobase/LightRAG.",
        "section": "§03 knowledge-stack",
    },
    {
        "title": "Proven end-to-end autonomy",
        "detail": "cortex_l7_trends shipped detect → generate → repair → sandbox → unanimous "
                  "council → canary → promote with no human in the inner loop.",
        "section": "§00 index",
    },
    {
        "title": "Real safety rails on code-gen",
        "detail": "The Genesys lanes have working gates, councils, daily caps, a panic-brake with "
                  "auto-re-arm, and a rollback tick — critical applies stay human-gated by policy.",
        "section": "§04 genesys-codegen",
    },
    {
        "title": "Redis-shared cortex state",
        "detail": "Most subsystem state is shared via Redis across the two uvicorn replicas, so "
                  "the cognition loop does not fork per-process for the shared paths.",
        "section": "§02 cortex-modules",
    },
    {
        "title": "18-provider router with fallback",
        "detail": "ProviderRouter + vault spread embeddings/LLM calls across 18 providers with "
                  "graceful fallback, keeping the free-tier strategy resilient.",
        "section": "§01 serving-topology",
    },
    {
        "title": "Zero-downtime deploy",
        "detail": "scripts/deploy.sh does a rolling recreate of the back replicas plus a hot-swap "
                  "of the front bundle — never a compose-down of prod.",
        "section": "§06 infra-ops",
    },
    {
        "title": "Evidence-based audit culture",
        "detail": "Periodic deep audits read the code and carry file:line evidence; this very "
                  "page is built on that discipline rather than on vibes.",
        "section": "§00 index",
    },
]

# status: "fixed" (re-verified resolved) | "partial" (re-wired, not fully closed) | "ambiguous" (needs an owner…
ISSUES: list[dict] = [
    {
        "id": "daily-digest-html",
        "severity": "P0",
        "area": "Observability",
        "title": "daily_digest html shadow",
        "detail": "The stdlib `html` module was shadowed, throwing UnboundLocalError on every run "
                  "(daily digest dead for a week). Now imports `html` at top and HTML-escapes values.",
        "evidence": "app/analytics/daily_digest.py:24",
        "status": "fixed",
        "verified": True,
    },
    {
        "id": "doc-ocr-status",
        "severity": "P0",
        "area": "Knowledge ingest",
        "title": 'doc_ocr "ok" vs "success" mismatch',
        "detail": "Ingestion returned status 'ok' while readers only accepted 'success', marking "
                  "false permanent_failures. Reader sets now accept both 'ok' and 'success'.",
        "evidence": "app/analytics/drive_ingestor.py:887",
        "status": "fixed",
        "verified": True,
    },
    {
        "id": "phase-d-learning",
        "severity": "P0",
        "area": "Cortex learning",
        "title": "Phase-D learning chain (promotion-to-wisdom)",
        "detail": "Audit found 9 promotion jobs with no trigger (the loop that turns experience into "
                  "policies/procedures/skills/wisdom/narrative was OFF). The *_promote / *_update / "
                  "*_weekly jobs are now present in WORKER_JOBS on both workers — re-wired, but per-job "
                  "schedule triggers still need a confirming pass.",
        "evidence": "docker-compose.yml WORKER_JOBS (learning_*_promote)",
        "status": "partial",
        "verified": True,
    },
    {
        "id": "neural-cortex-dual",
        "severity": "P0",
        "area": "Cortex / eventbus",
        "title": "neural_cortex double consumer",
        "detail": "neural_cortex still appears in two services' WORKER_JOBS while a compose comment "
                  "claims it should live on a single owner — competing eventbus consumers can "
                  "double-process or split events. Needs one explicit owner.",
        "evidence": "docker-compose.yml:2091,2408",
        "status": "ambiguous",
        "verified": True,
    },
    {
        "id": "mainpy-monolith",
        "severity": "P1",
        "area": "Maintainability",
        "title": "main.py is a 66K-line monolith",
        "detail": "65,913 lines and 1,139 routes live in a single file with an enormous lifespan "
                  "block. Hard to navigate, review and test; a structural development gap that grows "
                  "with every feature. Candidate for router-module extraction.",
        "evidence": "app/main.py (65,913 lines)",
        "status": "open",
        "verified": True,
    },
    {
        "id": "replica-divergence",
        "severity": "P1",
        "area": "Concurrency",
        "title": "Per-replica state divergence",
        "detail": "consume_and_nudge runs on both replicas (split nudges), sensor-bus rate-limit is "
                  "per-replica, Hopfield pub/sub eviction is unversioned and neural-state has a 10s read "
                  "throttle. Needs one architecture decision (leader-consumes + Redis, or fan-out groups).",
        "evidence": "§02 cortex-modules / prior concurrency audit",
        "status": "open",
        "verified": False,
    },
    {
        "id": "doc-id-collision",
        "severity": "P1",
        "area": "Knowledge ingest",
        "title": "doc_id = md5(filename) collision",
        "detail": "Drive doc_id is the md5 of the filename only, so same-named files in different "
                  "folders overwrite each other's chunks. Should key on folder+name or Drive file id.",
        "evidence": "§03 knowledge-stack",
        "status": "open",
        "verified": False,
    },
    {
        "id": "netdata-inactive",
        "severity": "P1",
        "area": "Observability",
        "title": "No disk / metric alerting",
        "detail": "Netdata is inactive despite the hardening claim; the 2026-05-22 disk-full class can "
                  "recur unseen. Dozzle gives logs but nothing alerts on disk/metrics.",
        "evidence": "§06 infra-ops",
        "status": "open",
        "verified": False,
    },
    {
        "id": "serving-security",
        "severity": "P2",
        "area": "Security",
        "title": "docker.sock + pid:host on the serving replica",
        "detail": "The replica that serves user traffic mounts docker.sock and shares pid:host, and "
                  "several secrets sit in plaintext in compose / scheduler_config / cron.d. Blast radius "
                  "of a serving-path compromise is the whole host.",
        "evidence": "§01 serving-topology / §06 infra-ops",
        "status": "open",
        "verified": False,
    },
    {
        "id": "datetime-naive",
        "severity": "P2",
        "area": "Tech debt",
        "title": "~40 files on naive datetime.utcnow()",
        "detail": "Naive UTC datetimes (worst offender ~30 calls in one module) cause intermittent "
                  "tz-comparison crashes. Apply the _naive_utc playbook opportunistically.",
        "evidence": "§02 cortex-modules",
        "status": "open",
        "verified": False,
    },
    {
        "id": "dead-code",
        "severity": "P2",
        "area": "Tech debt",
        "title": "Dead code & dormant modules",
        "detail": "Memobase endpoints, mem0 pool and WEB_LEARNER envs are dead; cortex_retrieval / "
                  "temporal shims linger; dormant modules (attention_watcher, F124 federation, ontology) "
                  "should be revived or retired rather than left half-wired.",
        "evidence": "§01 / §02 / §03",
        "status": "open",
        "verified": False,
    },
]

RECENTLY_FIXED = (
    "Genesis lane revived end-to-end (panic-brake auto-re-arm, permanent cron, language pin, "
    "rollback tick, transient retry, repair round); fix-lane funnel unstuck (anti-livelock council, "
    "autopilot tick, apply consumer, learn-back, import gate, critical human-only); daily_digest "
    "html shadow; doc_ocr status reconciliation; F95/F103 datetime hydration crashes; neural-state "
    "Redis TTL; per-replica eventbus consumer; Neo4j mirror NameError; canonical Tokens-tab contract; "
    "platform-wide llm_call AttributeError hotfix."
)


# ── curated per-project assessment (ported from the old platform's tech_assessment.py PROJECT_META at…
PROJECT_META: dict[str, dict] = {
    "ASA Intelligence": {
        "category": "AI platform / cortex (this system)",
        "status": "live",
        "blurb": "The platform itself — the in-house AI cortex + old platform this whole system runs on: "
                 "181 cortex modules, 1,139 API routes, a fully deterministic knowledge read-path "
                 "and proven autonomous code-gen. Full self-assessment in the Engineering State tab.",
        "strengths": [
            "Deterministic knowledge read-path (zero LLM tokens)",
            "Proven end-to-end autonomy (detect → generate → council → canary → promote)",
            "Real safety rails + zero-downtime deploy",
        ],
        "gaps": [
            "main.py is a 66K-line monolith",
            "Per-replica state divergence",
            "Observability theater (no metric alerting)",
        ],
        "baked_files": 0,
        "platform": True,
    },
    "ASA Healthcare old platform": {
        "category": "Healthcare old platform (this product)",
        "status": "live",
        "blurb": "The operational old platform we are actively building on top of the cortex — a React/TS SPA "
                 "for the home-care business: Clients & houses, Calendar & shift reconciliation, Staff "
                 "& HR, Medications & MAR errors, Purchasing & invoices, Compliance/training, an Audit "
                 "library and this Technology portfolio. Shares the platform's real data with a per-world "
                 "isolated UI; deployed daily with zero downtime.",
        "strengths": [
            "Broad operational coverage (clients, scheduling, HR, meds, billing, audit)",
            "Shares real platform data; per-world isolated UI (no forked sources)",
            "Daily zero-downtime deploys (rolling back replicas + SPA hot-swap)",
        ],
        "gaps": [
            "Large SPA bundle (App chunk >3 MB) — code-splitting pending",
            "Several tabs still in active build / DEPLOY PENDING",
            "Leans on the cortex platform's read-path + endpoints",
        ],
        "baked_files": 0,
    },
    "MyLife OS": {
        "category": "Life/work-management OS (Apps Script)",
        "status": "in_use",
        "blurb": "In-house 'OS' on Google Apps Script (asa-core) with a Data v2 ecosystem — a module/bot "
                 "platform with a universal cache & data-access spec, a named-dataset registry and "
                 "role/scope authorization, now mid-rewrite to a v2 platform (platform / modules / data / "
                 "_migration). Drives personal and care-plan workflows under a work-item + code-path "
                 "evidence governance convention.",
        "strengths": [
            "Real Data v2 ecosystem: cache-key dictionary, named-dataset registry, scoped auth",
            "v2 platform rewrite under way (platform / modules / data / migration)",
            "Governance discipline — WI work-items + code-path evidence conventions",
        ],
        "gaps": [
            "Apps Script / CacheService limits (250-char keys, quotas)",
            "Sits apart from the main Python platform",
            "Large surface (~600 files) still mid-migration to v2",
        ],
        "baked_files": 599,
    },
    "Jarvis": {
        "category": "Agentic governance & asset/comms automation",
        "status": "in_use",
        "blurb": "An agent-driven capability-improvement program across Asset Management, Smart Comms and "
                 "Data/Form Management — each with a current-understanding assessment, a target model + "
                 "improvement backlog and a phased project plan. Runs governed, dated pilots (Phase 1 "
                 "Governance Foundation -> Phase 2 CPR-Renewal pilot -> Phase 05 ecosystem integration) "
                 "with evidence reports and a Space/Coordinator agent.",
        "strengths": [
            "Structured per-domain method: assessment -> target model -> backlog -> project plan",
            "Governed phased pilots with dated evidence (CPR Renewal, Asset Registry WI_129)",
            "Universal Feedback Loop + coordinator agent across domains",
        ],
        "gaps": [
            "Pilot-stage — not yet a productionized service",
            "Heavy doc/process footprint; automation depth varies by domain",
            "Lives in the Apps Script ecosystem, separate from the Python platform",
        ],
        "baked_files": 87,
    },
    "Work OS": {
        "category": "Work execution & operations OS",
        "status": "experimental",
        "blurb": "The work/operations counterpart in the asa-core ecosystem — a Work OS that runs governed "
                 "work instances (readiness -> instance execution -> evidence-reference contract) with "
                 "asset-lifecycle observability and capability-lane selection. Folder being added; the card "
                 "fills with live folder stats once it is mounted in the cache.",
        "strengths": [
            "Phased, evidence-backed work execution (readiness, instance execution, retrospectives)",
            "Work-item (WI) + evidence-reference contract discipline",
        ],
        "gaps": [
            "Folder not yet in the cache (being added)",
            "Early/experimental; scope still consolidating with MyLife OS / Jarvis",
        ],
        "baked_files": 0,
    },
    "Intranet": {
        "category": "Internal web client (Apps Script + JS SPA)",
        "status": "operational",
        "blurb": "The ASA Lifecare Intranet — the in-house web client (Google Apps Script + JS SPA) over "
                 "17+ Sheets tabs that runs the homecare operation: a modular render system (Client / "
                 "Common / Modular Render data contracts, R3), ISP rendering (Client ISP, ISP JSON "
                 "Decoded), eMAR, an employee directory and a versioned release pipeline. The live "
                 "operational predecessor the ASA Healthcare old platform is modernizing onto Postgres.",
        "strengths": [
            "Released, in-use web client with a versioned release pipeline (Release Notes / Releases)",
            "Modular render system over 17+ Sheets tabs (Client / Common / Modular data contracts R3)",
            "Covers ISP rendering, eMAR and the employee directory — the real operational surface",
        ],
        "gaps": [
            "Apps Script + Sheets backend — quota/scale ceilings, Sheets-as-database fragility",
            "Being superseded by the ASA Healthcare old platform (data migrating off Sheets to Postgres)",
            "Render data contracts versioned in Drive PDFs, not in the platform",
        ],
        "baked_files": 71,
    },
    "SONA": {
        "category": "Comms AI agents",
        "status": "live",
        "blurb": "Voice/comms agents over the Employee Support Hotline: an Employee Support Agent "
                 "that turns OpenPhone threads into structured request tickets (Schedule / ADP / "
                 "incident) and a Phone Screening Agent for recruiting calls.",
        "strengths": [
            "Employee Support Hotline is live (DSP calls → OpenPhone → LLM → Sheets)",
            "Structured JSON ticket output against a fixed category set",
            "Real, dated prompt + knowledge iterations",
        ],
        "gaps": [
            "Phone Screening Agent less mature than the Support agent",
            "Prompts/knowledge versioned in Drive, not in the platform",
            "No closed-loop metric on categorization accuracy",
        ],
        "baked_files": 4,
    },
    "Jarbas": {
        "category": "Agent OS",
        "status": "experimental",
        "blurb": "In-house 'Jarvis OS' agent platform on Google Apps Script + Firebase Cloud "
                 "Functions — orchestrator (Code.gs), atomic abilities (Abilities.gs), Firebase "
                 "integration and a graceful error-router. Iterated V1.0 Agent → V1.2 Meeting Assistant.",
        "strengths": [
            "Clean separation: orchestrator / atomic abilities / Firebase",
            "Graceful error router (missing-params, ambiguous, firebase-down, capability-limit)",
            "Versioned V1.0 → V1.2 with a meeting-assistant test",
        ],
        "gaps": [
            "Half-implemented — not productionized or monitored",
            "GAS + Firebase stack sits apart from the main Python platform",
            "No live deployment path today",
        ],
        "baked_files": 13,
    },
    "Monthly Doc Scan": {
        "category": "Document OCR pipeline",
        "status": "operational",
        "blurb": "Monthly ingestion + OCR of operational documents (med docs, pay stubs, Medicaid "
                 "requests, background checks, tracking sheets) — the feed behind the doc_ocr "
                 "knowledge pipeline.",
        "strengths": [
            "Real OCR + ingestion at volume (~125 MB monthly batch)",
            "Handles heterogeneous document types",
        ],
        "gaps": [
            "doc_id = md5(filename) → same-named files can collide",
            "PII-heavy (pay stubs, background checks) — must stay reference-only",
            "Historically silent permanent_failures (status mismatch, now fixed)",
        ],
        "baked_files": 59,
    },
    "Talent Management Pipeline": {
        "category": "Recruitment automation",
        "status": "in_use",
        "blurb": "Resume intake + LLM analysis pipeline — a Resume Analysis Prompt scoring 100+ "
                 "candidate resumes, with a CJIS background track.",
        "strengths": [
            "Scaled (100+ resumes, dated through 2026-06)",
            "Structured resume-analysis prompt",
        ],
        "gaps": [
            "No visible scoring-quality feedback loop",
            "PII-heavy — handle resumes as sensitive",
        ],
        "baked_files": 100,
    },
    "Talent Pipeline Flow": {
        "category": "Recruitment automation",
        "status": "live",
        "blurb": "Server-side movement log for Talent Pipeline v2 — every Work Engine intent "
                 "(candidate start, evidence form, stage move) lands in ops.talent_flow_events, "
                 "plus a resume store mirroring every Resume Editor upload to the server.",
        "strengths": [
            "Live feed: GET /v1/talent/flow/events + /flow/summary (admin)",
            "Resume archive: GET /v1/talent/resume-store/list (admin)",
            "Work Engine untouched — log is a side-channel, never authority",
        ],
        "gaps": [
            "Populated only after talent-v2 republish (flow hook ships with it)",
            "PII-heavy — resumes and candidate names; admin-only reads",
        ],
        "baked_files": 0,
    },
    "Process Management": {
        "category": "Knowledge & process framework",
        "status": "framework",
        "blurb": "The methodology base for the automations: Persona Start, Knowledge Start, the HPI "
                 "Framework, the KITE Method and homecare white papers.",
        "strengths": [
            "Documented methodology (HPI / KITE)",
            "Persona + Knowledge starting templates",
        ],
        "gaps": [
            "Methodology not yet wired into the live cortex",
            "Mostly static reference docs",
        ],
        "baked_files": 10,
    },
    "Resume Edits": {
        "category": "Candidate document service",
        "status": "in_use",
        "blurb": "Resume & cover-letter editing producing versioned candidate documents (MCv1 → vF).",
        "strengths": [
            "Versioned outputs (v1 → final)",
            "22 candidate documents produced",
        ],
        "gaps": [
            "Manual-leaning; not clearly automated end-to-end",
        ],
        "baked_files": 22,
    },
    "New Hires": {
        "category": "Onboarding automation",
        "status": "in_use",
        "blurb": "New-hire onboarding: questionnaire intake, a scheduling site and prompt-driven "
                 "processing of the responses.",
        "strengths": [
            "Questionnaire → structured intake",
            "Scheduling site in place",
        ],
        "gaps": [
            "Small footprint; limited automation depth",
        ],
        "baked_files": 3,
    },
    "Training and Development": {
        "category": "Training automation",
        "status": "early",
        "blurb": "Training & development tracking (sheet-based) — earliest-stage project.",
        "strengths": [
            "Started",
        ],
        "gaps": [
            "Single artifact — barely developed",
        ],
        "baked_files": 1,
    },
    "0 - Archive": {
        "category": "Archive",
        "status": "archived",
        "blurb": "Archived / legacy project material kept for reference.",
        "strengths": [],
        "gaps": [],
        "baked_files": 9,
    },
}

# order projects roughly by maturity/state for a calm read; archived always last (includes the admin-set dropdown…
STATUS_RANK = {
    "live": 0, "operational": 1, "in use": 2, "in_use": 2, "concluded": 2,
    "framework": 3, "in progress": 3, "experimental": 4, "on hold": 4,
    "early": 5, "not started": 5, "unassessed": 6, "archived": 9,
}
