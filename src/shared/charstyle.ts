/**
 * Style presets for AI-generated characters (spec 096 FR-050, FR-051, D4). One look for everyone in v1: the user's description changes
 * the person, never the style. Changing a prefix makes a new id (`-v2`); saved characters keep the id they were made with.
 */
export interface StylePreset {
  /** `name-vN`, lower case. Stored with every generated character. */
  id: string;
  /** The first part of the prompt (chargen.ts adds the layout block and the guarded description after it). */
  prefix: string;
}

export const STYLE_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-v[0-9]+$/;

export const STYLE_PRESETS: readonly StylePreset[] = [
  {
    id: 'realistic-office-v1',
    prefix: 'Realistic, softly lit 3D-rendered illustration of an office worker, isometric three-quarter view from slightly above, soft natural daylight from a window on the left, gentle shadows, muted natural colours, matte materials, calm expression, high detail on face and hands, transparent background, no text.',
  },
];

export const DEFAULT_STYLE_ID = STYLE_PRESETS[0].id;

/** The preset with this id, or undefined (a saved character may name a style this build no longer knows). */
export function stylePreset(id: string): StylePreset | undefined {
  return STYLE_PRESETS.find((s) => s.id === id);
}
