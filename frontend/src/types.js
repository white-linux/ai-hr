/**
 * Data contracts shared by the UI, the service layer and the mocks.
 * Backend responses should match these shapes (or be mapped to them inside
 * src/services/*), so that no component needs to change during integration.
 *
 * @typedef {'it' | 'marketing' | 'sales' | 'finance'} VerticalId
 *
 * @typedef {Object} CV                 Column 1 — raw CV from the database
 * @property {string}     id
 * @property {string}     candidateName
 * @property {string}     email
 * @property {VerticalId} vertical
 * @property {string}     role             Position the candidate applied for
 * @property {number}     yearsExperience
 * @property {string[]}   skills
 * @property {string}     receivedAt       ISO date
 * @property {string=}    cvUrl            Link to the original file, if any
 *
 * @typedef {Object} ScanResult         Column 2 — CV evaluated by the AI
 * @property {string}     id
 * @property {string}     cvId
 * @property {string}     candidateName
 * @property {VerticalId} vertical
 * @property {string}     role
 * @property {number}     score            AI match score, 0–100
 * @property {string[]}   matchedSkills
 * @property {string}     summary          Short AI justification for the score
 * @property {string}     scannedAt        ISO date
 *
 * @typedef {Object} SentTask           Column 3 — task sent to a candidate
 * @property {string}     id
 * @property {string}     cvId
 * @property {string}     candidateName
 * @property {VerticalId} vertical
 * @property {number}     score            Score that qualified the candidate
 * @property {string}     title
 * @property {string}     snippet          Short preview of the task brief
 * @property {string}     sentAt           ISO date
 * @property {string}     dueAt            ISO date
 *
 * @typedef {Object} Submission         Column 4 — a returned task
 * @property {string}     id
 * @property {string}     taskId
 * @property {string}     cvId
 * @property {string}     candidateName
 * @property {VerticalId} vertical
 * @property {string}     taskTitle
 * @property {string}     submittedAt      ISO date
 * @property {string}     excerpt          Preview of the candidate's answer
 *
 * @typedef {Object} IntegrityAnalysis  Result of analyzeTaskIntegrity()
 * @property {number}     aiGenerationProbability  0–100, from the AI detector
 * @property {number}     correctnessScore         0–100
 * @property {'pass' | 'review' | 'fail'} verdict
 * @property {string}     summary                  Task correctness analysis
 * @property {string}     analyzedAt               ISO date
 *
 * @typedef {Submission & { analysis: IntegrityAnalysis | null, analysisError?: string }} AnalyzedSubmission
 */

export {};
