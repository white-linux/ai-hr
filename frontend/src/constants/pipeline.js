export const STAGE = {
  IDLE: 'idle',
  SCANNING: 'scanning',
  SENDING: 'sending',
  ANALYZING: 'analyzing',
  DONE: 'done',
};

export const STAGE_LABEL = {
  [STAGE.IDLE]: 'Ready',
  [STAGE.SCANNING]: 'Scanning CVs with AI…',
  [STAGE.SENDING]: 'Sending tasks to qualified candidates…',
  [STAGE.ANALYZING]: 'Analyzing returned tasks…',
  [STAGE.DONE]: 'Pipeline finished',
};

export const RUNNING_STAGES = [STAGE.SCANNING, STAGE.SENDING, STAGE.ANALYZING];
