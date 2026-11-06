/** @type {import('../types').CV[]} */
export const MOCK_CVS = [
  { id: 'cv-001', candidateName: 'Aysel Mammadova', email: 'aysel.m@example.com', vertical: 'it', role: 'Frontend Developer', yearsExperience: 4, skills: ['React', 'TypeScript', 'Tailwind', 'Testing'], receivedAt: '2026-11-01T09:12:00Z' },
  { id: 'cv-002', candidateName: 'Rashad Aliyev', email: 'rashad.a@example.com', vertical: 'it', role: 'Full-stack Developer', yearsExperience: 6, skills: ['React', 'Node.js', 'TypeScript', 'REST', 'PostgreSQL'], receivedAt: '2026-11-01T11:40:00Z' },
  { id: 'cv-003', candidateName: 'Leyla Hasanova', email: 'leyla.h@example.com', vertical: 'it', role: 'Junior Frontend Developer', yearsExperience: 1, skills: ['JavaScript', 'HTML', 'CSS', 'React'], receivedAt: '2026-11-02T08:05:00Z' },
  { id: 'cv-004', candidateName: 'Elvin Guliyev', email: 'elvin.g@example.com', vertical: 'it', role: 'Backend Developer', yearsExperience: 5, skills: ['Python', 'Django', 'REST', 'Docker'], receivedAt: '2026-11-02T14:22:00Z' },
  { id: 'cv-005', candidateName: 'Nigar Ismayilova', email: 'nigar.i@example.com', vertical: 'it', role: 'Frontend Engineer', yearsExperience: 3, skills: ['React', 'TypeScript', 'Next.js', 'Testing'], receivedAt: '2026-11-03T10:18:00Z' },
  { id: 'cv-006', candidateName: 'Tural Babayev', email: 'tural.b@example.com', vertical: 'it', role: 'Mobile Developer', yearsExperience: 2, skills: ['Flutter', 'Dart', 'Firebase'], receivedAt: '2026-11-03T16:47:00Z' },
  { id: 'cv-007', candidateName: 'Gunel Rzayeva', email: 'gunel.r@example.com', vertical: 'marketing', role: 'Performance Marketer', yearsExperience: 5, skills: ['Google Ads', 'Analytics', 'SEO', 'A/B Testing'], receivedAt: '2026-11-01T13:30:00Z' },
  { id: 'cv-008', candidateName: 'Kamran Huseynov', email: 'kamran.h@example.com', vertical: 'marketing', role: 'Content Strategist', yearsExperience: 3, skills: ['Content Strategy', 'Copywriting', 'SEO'], receivedAt: '2026-11-02T09:55:00Z' },
  { id: 'cv-009', candidateName: 'Sevinj Karimova', email: 'sevinj.k@example.com', vertical: 'marketing', role: 'SMM Specialist', yearsExperience: 2, skills: ['Instagram', 'Canva', 'Copywriting'], receivedAt: '2026-11-04T12:10:00Z' },
  { id: 'cv-010', candidateName: 'Murad Jafarov', email: 'murad.j@example.com', vertical: 'marketing', role: 'Growth Marketer', yearsExperience: 7, skills: ['Google Ads', 'Analytics', 'Content Strategy', 'CRM'], receivedAt: '2026-11-04T15:02:00Z' },
  { id: 'cv-011', candidateName: 'Farid Mammadli', email: 'farid.m@example.com', vertical: 'sales', role: 'Account Executive', yearsExperience: 6, skills: ['Salesforce', 'Negotiation', 'Lead Generation'], receivedAt: '2026-11-01T10:45:00Z' },
  { id: 'cv-012', candidateName: 'Aynur Abbasova', email: 'aynur.a@example.com', vertical: 'sales', role: 'Sales Development Rep', yearsExperience: 2, skills: ['HubSpot', 'Cold Calling', 'Lead Generation'], receivedAt: '2026-11-03T08:30:00Z' },
  { id: 'cv-013', candidateName: 'Orkhan Valiyev', email: 'orkhan.v@example.com', vertical: 'sales', role: 'Retail Sales Lead', yearsExperience: 4, skills: ['Customer Service', 'Negotiation'], receivedAt: '2026-11-05T11:20:00Z' },
  { id: 'cv-014', candidateName: 'Lala Safarova', email: 'lala.s@example.com', vertical: 'finance', role: 'Financial Analyst', yearsExperience: 4, skills: ['Excel', 'Financial Modeling', 'SQL', 'FP&A'], receivedAt: '2026-11-02T10:00:00Z' },
  { id: 'cv-015', candidateName: 'Javid Novruzov', email: 'javid.n@example.com', vertical: 'finance', role: 'Junior Accountant', yearsExperience: 1, skills: ['Excel', '1C', 'Bookkeeping'], receivedAt: '2026-11-04T09:40:00Z' },
  { id: 'cv-016', candidateName: 'Shahla Mustafayeva', email: 'shahla.m@example.com', vertical: 'finance', role: 'Audit Associate', yearsExperience: 5, skills: ['IFRS', 'Audit', 'Excel', 'Financial Modeling'], receivedAt: '2026-11-05T14:15:00Z' },
];

/** One take-home task per vertical. */
export const TASK_TEMPLATES = {
  it: { title: 'Build a filterable data table', snippet: 'Using React + TypeScript, build a table that fetches users from a public API, supports search, sorting and pagination, and includes unit tests.' },
  marketing: { title: 'Launch plan for a fintech app', snippet: 'Draft a 30-day paid + organic launch plan for a mobile banking app with a $10k budget. Include channels, KPIs and expected CAC.' },
  sales: { title: 'Discovery call & objection handling', snippet: 'Write a discovery call script for a mid-size logistics company and respond to three common pricing objections.' },
  finance: { title: '3-statement model for a retail chain', snippet: 'Build a simple 3-statement model for a 12-store retail chain from the attached figures and comment on the cash-flow risks.' },
};

export const SUBMISSION_EXCERPTS = {
  it: [
    'Implemented with React Query for caching; sorting and filtering are memoized. 14 tests with Vitest + RTL.',
    'Used a custom useTable hook, debounced search and server-side pagination. README explains trade-offs.',
    'Table works but pagination is client-side only. No tests included due to time constraints.',
  ],
  marketing: [
    'Split budget 60/40 paid vs organic; focus on Meta + Google UAC in week 1, influencer push in week 3.',
    'Proposed referral loop with a 5 AZN bonus, projected CAC of $4.20 based on regional benchmarks.',
    'Plan centers on TikTok content series; KPIs are installs, D7 retention and cost per activation.',
  ],
  sales: [
    'Script opens with a pain-led question about delivery delays, then qualifies with BANT.',
    'Objection “too expensive” reframed via ROI calculator; offered a pilot on 2 routes.',
    'Focused on rapport-building; objection answers are short and lean on discounts.',
  ],
  finance: [
    'Model links all three statements with a working capital schedule; flags inventory build-up in Q3.',
    'Balance sheet balances; sensitivity table on same-store sales growth included.',
    'Income statement complete, cash-flow statement partially linked — capex not modeled.',
  ],
};

export const ANALYSIS_SUMMARIES = {
  pass: [
    'Meets all requirements with clean structure. Edge cases handled and reasoning is clearly explained.',
    'Correct and well-organized solution. Minor style issues only; demonstrates solid domain knowledge.',
  ],
  review: [
    'Core requirements met, but some parts are shallow. Recommend a follow-up interview to verify depth.',
    'Mostly correct with a few gaps in edge cases. Writing style is inconsistent across sections.',
  ],
  fail: [
    'Key requirements missing and several factual errors. Structure suggests heavy templated content.',
    'Answer is generic and does not address the brief. Large sections closely match AI-generated patterns.',
  ],
};
