import { z } from 'zod';
import type { RendererSpec } from './spec';

export const SEQUENCER_LIMITS = { rows: 6, steps: 16, degree: 15, bpmMin: 40, bpmMax: 240, midiMin: 36, midiMax: 96 } as const;
const SHARP_ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const FLAT_ROOTS: Record<string, number> = { Db: 1, Eb: 3, Gb: 6, Ab: 8, Bb: 10 };
const NAMES_SHARP = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
const NAMES_FLAT = ['Do', 'Re♭', 'Re', 'Mi♭', 'Mi', 'Fa', 'Sol♭', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];
export const SEQUENCER_MODES = {
  major: { name: 'mayor', intervals: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: 'menor', intervals: [0, 2, 3, 5, 7, 8, 10] },
  dorian: { name: 'dórica', intervals: [0, 2, 3, 5, 7, 9, 10] },
  'pentatonic-major': { name: 'pentatónica mayor', intervals: [0, 2, 4, 7, 9] },
  'pentatonic-minor': { name: 'pentatónica menor', intervals: [0, 3, 5, 7, 10] },
  blues: { name: 'de blues', intervals: [0, 3, 5, 6, 7, 10] },
} as const;
type Mode = keyof typeof SEQUENCER_MODES;
const scaleSchema = z.object({
  root: z.enum([...SHARP_ROOTS, 'Db', 'Eb', 'Gb', 'Ab', 'Bb']),
  mode: z.enum(Object.keys(SEQUENCER_MODES) as [Mode, ...Mode[]]),
  octave: z.number().int().min(2).max(5).default(4),
}).strict();
const tempoSchema = z.object({
  bpm: z.number().int().min(SEQUENCER_LIMITS.bpmMin).max(SEQUENCER_LIMITS.bpmMax),
  min: z.number().int().min(SEQUENCER_LIMITS.bpmMin).max(SEQUENCER_LIMITS.bpmMax).default(60),
  max: z.number().int().min(SEQUENCER_LIMITS.bpmMin).max(SEQUENCER_LIMITS.bpmMax).default(180),
}).strict();
const patternRow = z.string().regex(/^[x.]+$/).max(SEQUENCER_LIMITS.steps);
const shape = z.object({
  question: z.string().trim().min(1).max(1000),
  scale: scaleSchema,
  /** Scale degrees, 1 = root. Degrees beyond the scale length continue into the next octave. */
  rows: z.array(z.number().int().min(1).max(SEQUENCER_LIMITS.degree)).min(1).max(SEQUENCER_LIMITS.rows),
  labels: z.enum(['note', 'degree']).default('note'),
  steps: z.number().int().min(2).max(SEQUENCER_LIMITS.steps),
  stepsPerBeat: z.number().int().min(1).max(4).default(2),
  tempo: tempoSchema,
  /** One string per row, aligned with `rows`: `x` sounds, `.` is silent. */
  pattern: z.array(patternRow).min(1).max(SEQUENCER_LIMITS.rows),
  voice: z.enum(['sine', 'triangle', 'square']).default('triangle'),
}).strict();
export type StepSequencerData = z.infer<typeof shape>;
export type SequencerScale = StepSequencerData['scale'];

const rootClass = (root: string) => FLAT_ROOTS[root] ?? SHARP_ROOTS.indexOf(root as typeof SHARP_ROOTS[number]);
/** MIDI note of a one-based degree of the locked scale. */
export function degreeMidi(scale: SequencerScale, degree: number): number {
  const intervals = SEQUENCER_MODES[scale.mode].intervals, index = degree - 1;
  return 12 * (scale.octave + 1) + rootClass(scale.root) + intervals[index % intervals.length] + 12 * Math.floor(index / intervals.length);
}
export const midiFrequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
export function noteName(scale: SequencerScale, midi: number): string {
  return `${(scale.root in FLAT_ROOTS ? NAMES_FLAT : NAMES_SHARP)[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
export function scaleName(scale: SequencerScale): string {
  return `${noteName(scale, rootClass(scale.root) + 12).slice(0, -1)} ${SEQUENCER_MODES[scale.mode].name}`;
}
export type SequencerRow = { index: number; degree: number; midi: number; frequency: number; note: string; label: string };
/** Rows in display order, highest pitch first. `index` points back into `rows` and `pattern`. */
export function sequencerRows(data: Pick<StepSequencerData, 'scale' | 'rows' | 'labels'>): SequencerRow[] {
  const length = SEQUENCER_MODES[data.scale.mode].intervals.length;
  return data.rows.map((degree, index) => {
    const midi = degreeMidi(data.scale, degree), note = noteName(data.scale, midi);
    return { index, degree, midi, frequency: midiFrequency(midi), note, label: data.labels === 'note' ? note : `${((degree - 1) % length) + 1}${'′'.repeat(Math.floor((degree - 1) / length))}` };
  }).sort((a, b) => b.midi - a.midi);
}
export const stepSeconds = (bpm: number, stepsPerBeat: number) => 60 / bpm / stepsPerBeat;
export const clampTempo = (tempo: StepSequencerData['tempo'], value: number) => Number.isFinite(value) ? Math.max(tempo.min, Math.min(tempo.max, Math.round(value))) : tempo.bpm;

export const stepSequencerDataSchema = shape.superRefine((data, context) => {
  const issue = (path: (string | number)[], message: string) => context.addIssue({ code: 'custom', path, message });
  if (new Set(data.rows).size !== data.rows.length) issue(['rows'], 'Each row needs a different scale degree.');
  data.rows.forEach((degree, i) => {
    const midi = degreeMidi(data.scale, degree);
    if (midi < SEQUENCER_LIMITS.midiMin || midi > SEQUENCER_LIMITS.midiMax) issue(['rows', i], 'This degree leaves the supported pitch range. Lower the octave or the degree.');
  });
  if (data.pattern.length !== data.rows.length) issue(['pattern'], 'The pattern needs exactly one string per row.');
  data.pattern.forEach((row, i) => { if (row.length !== data.steps) issue(['pattern', i], `Each pattern row needs exactly ${data.steps} characters, x or a period.`); });
  if (data.tempo.min > data.tempo.max || data.tempo.bpm < data.tempo.min || data.tempo.bpm > data.tempo.max) issue(['tempo'], 'Tempo needs min <= bpm <= max.');
});

export type StepSequencerState = { pattern: string[]; bpm: number };
/** The learner's runtime pattern, or the authored one when the stored shape no longer fits the data. */
export function sequencerState(data: StepSequencerData, raw: Readonly<Record<string, unknown>>): StepSequencerState {
  const stored = raw.pattern;
  const fits = Array.isArray(stored) && stored.length === data.rows.length && stored.every(row => typeof row === 'string' && row.length === data.steps && /^[x.]+$/.test(row));
  return { pattern: fits ? [...stored as string[]] : [...data.pattern], bpm: typeof raw.bpm === 'number' ? clampTempo(data.tempo, raw.bpm) : data.tempo.bpm };
}
export const cellOn = (pattern: readonly string[], row: number, step: number) => pattern[row]?.[step] === 'x';
export function toggleCell(pattern: readonly string[], row: number, step: number): string[] {
  return pattern.map((value, i) => i === row && step >= 0 && step < value.length ? `${value.slice(0, step)}${value[step] === 'x' ? '.' : 'x'}${value.slice(step + 1)}` : value);
}
export const noteCount = (pattern: readonly string[]) => pattern.reduce((sum, row) => sum + row.split('x').length - 1, 0);
export const samePattern = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((row, i) => row === b[i]);
/** Bounded settled description: final pattern and tempo, never playback position. */
export function sequencerSummary(data: StepSequencerData, state: StepSequencerState, heard: boolean) {
  return { scale: scaleName(data.scale), bpm: state.bpm, steps: data.steps, notes: noteCount(state.pattern), changed: !samePattern(state.pattern, data.pattern) || state.bpm !== data.tempo.bpm, heard,
    rows: sequencerRows(data).map(row => ({ note: row.note, degree: row.degree, pattern: state.pattern[row.index] })) };
}
export function sequencerDescription(data: StepSequencerData, state: StepSequencerState): string {
  const rows = sequencerRows(data).map(row => {
    const on = [...state.pattern[row.index]].flatMap((cell, step) => cell === 'x' ? [step + 1] : []);
    return `${row.note}: ${on.length ? `${on.length === 1 ? 'paso' : 'pasos'} ${on.join(', ')}` : 'sin notas'}.`;
  });
  return `Patrón de ${data.steps} pasos a ${state.bpm} pulsos por minuto, escala de ${scaleName(data.scale)}. ${rows.join(' ')}`;
}

export const stepSequencerSpec = {
  id: 'step-sequencer', dataSchema: stepSequencerDataSchema, interactive: true,
  minSize: { width: 320, height: 320 }, defaultSize: { width: 560, height: 440 },
  guidance: 'Set question, a locked scale {root (C..B, sharps or Db/Eb/Gb/Ab/Bb), mode (major/minor/dorian/pentatonic-major/pentatonic-minor/blues), octave 2..5}, rows as 1..6 distinct one-based scale degrees (up to 15, continuing into higher octaves), steps 2..16, stepsPerBeat 1..4, tempo {bpm,min,max} within 40..240, and pattern: one string per row, aligned with rows, of exactly `steps` characters where x sounds and . is silent. labels is note or degree; voice is sine, triangle or square. The learner toggles cells and tempo only: pitches stay in the declared scale. Runtime stores the learner pattern and bpm; playback position is never stored or reported. Audio starts only from the learner\'s Reproducir press on web; native shows the labelled pattern without sound.',
  blockType: {
    id: 'step-sequencer', renderer: 'step-sequencer', name: 'Secuenciador', description: 'Una rejilla de pasos audible con escala fija y tempo acotado.',
    properties: [
      { key: 'question', label: 'Pregunta guía', kind: 'text', required: true },
      { key: 'scale', label: 'Escala fija', kind: 'json', required: true },
      { key: 'rows', label: 'Grados de la escala por fila', kind: 'json', required: true },
      { key: 'labels', label: 'Rótulos: note o degree', kind: 'text', required: false },
      { key: 'steps', label: 'Pasos', kind: 'number', required: true },
      { key: 'stepsPerBeat', label: 'Pasos por pulso', kind: 'number', required: false },
      { key: 'tempo', label: 'Tempo y sus límites', kind: 'json', required: true },
      { key: 'pattern', label: 'Patrón inicial', kind: 'json', required: true },
      { key: 'voice', label: 'Timbre: sine, triangle o square', kind: 'text', required: false },
    ],
    defaults: {
      question: 'Ejemplo: ¿qué cambia si mueves la segunda nota un paso más tarde?',
      scale: { root: 'C', mode: 'pentatonic-major', octave: 4 }, rows: [5, 4, 3, 2, 1], labels: 'note',
      steps: 8, stepsPerBeat: 2, tempo: { bpm: 96, min: 60, max: 160 },
      pattern: ['........', '....x...', '..x.....', '......x.', 'x.......'], voice: 'triangle',
    },
  },
} satisfies RendererSpec;
