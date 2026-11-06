import { useState } from 'react';
import { DEFAULT_THRESHOLD, VERTICALS, VERTICAL_BY_ID } from '../constants/verticals';

/**
 * HR's control-panel inputs. Each vertical keeps its own prompt, so switching
 * from IT to Sales and back doesn't lose edits.
 * To persist prompts on the server later, load/save `prompts` here.
 */
export function useScanSettings() {
  const [vertical, setVertical] = useState(VERTICALS[0].id);
  const [prompts, setPrompts] = useState(() =>
    Object.fromEntries(VERTICALS.map((v) => [v.id, v.defaultPrompt])),
  );
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);

  const prompt = prompts[vertical];

  return {
    vertical,
    setVertical,
    prompt,
    setPrompt: (value) => setPrompts((prev) => ({ ...prev, [vertical]: value })),
    resetPrompt: () =>
      setPrompts((prev) => ({ ...prev, [vertical]: VERTICAL_BY_ID[vertical].defaultPrompt })),
    isPromptEdited: prompt !== VERTICAL_BY_ID[vertical].defaultPrompt,
    threshold,
    setThreshold: (value) => setThreshold(Math.min(100, Math.max(0, Math.round(value) || 0))),
  };
}
