/**
 * Verticals HR can scan for. `defaultPrompt` pre-fills the evaluation
 * criteria; HR can edit it per vertical in the control panel.
 * Later this list can come from the backend (e.g. GET /verticals).
 */
export const VERTICALS = [
  {
    id: 'it',
    label: 'IT',
    defaultPrompt:
      'Frontend/full-stack developers. Must have React and TypeScript. Node.js, REST APIs and testing experience are a plus. Prefer 3+ years of production experience.',
  },
  {
    id: 'marketing',
    label: 'Marketing',
    defaultPrompt:
      'Performance marketers. Look for SEO, Google Ads and Analytics experience, measurable campaign results, and content strategy skills.',
  },
  {
    id: 'sales',
    label: 'Sales',
    defaultPrompt:
      'B2B account executives. Look for CRM (Salesforce / HubSpot) usage, negotiation skills, quota attainment and lead generation experience.',
  },
  {
    id: 'finance',
    label: 'Finance',
    defaultPrompt:
      'Financial analysts. Look for Excel, financial modeling, IFRS reporting and SQL. Prefer candidates with audit or FP&A background.',
  },
];

export const VERTICAL_BY_ID = Object.fromEntries(VERTICALS.map((v) => [v.id, v]));

export const DEFAULT_THRESHOLD = 70;
