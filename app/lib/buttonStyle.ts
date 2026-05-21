/**
 * Button style utility. Composes Tailwind classes for the small set of
 * button intents the UI uses. Replaces the previous reliance on
 * daisyUI's `.btn` component classes.
 */

const BASE =
  'inline-flex items-center justify-center rounded-lg font-bold uppercase tracking-wide ' +
  'transition-colors select-none ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

const SIZE = {
  md: 'px-4 py-2 text-sm',
  sm: 'px-3 py-1 text-xs',
} as const;

const VARIANT = {
  primary: 'bg-yellow-400 hover:bg-yellow-300 text-slate-900',
  success: 'bg-emerald-600 hover:bg-emerald-500 text-white',
  info: 'bg-sky-600 hover:bg-sky-500 text-white',
  warning: 'bg-amber-500 hover:bg-amber-400 text-slate-900',
  danger: 'bg-red-600 hover:bg-red-500 text-white',
  neutral: 'bg-slate-700 hover:bg-slate-600 text-white',
  ghost: 'bg-transparent hover:bg-emerald-800/60 text-emerald-200 hover:text-white',
} as const;

/**
 * `dark` (default): emerald-950 page background — yellow ring is highly
 * visible. `light`: button sits on a yellow / light background (e.g.
 * the winning outcome banner) where a yellow ring vanishes. Switches to
 * a slate ring with a yellow offset for high contrast.
 */
const FOCUS = {
  dark: 'focus-visible:ring-yellow-400 focus-visible:ring-offset-emerald-950',
  light: 'focus-visible:ring-slate-900 focus-visible:ring-offset-yellow-300',
} as const;

export type ButtonVariant = keyof typeof VARIANT;
export type ButtonSize = keyof typeof SIZE;
export type ButtonTone = keyof typeof FOCUS;

export function buttonClass(
  opts: {
    variant?: ButtonVariant;
    size?: ButtonSize;
    /** Background context the button sits on — controls focus-ring contrast. */
    tone?: ButtonTone;
    className?: string;
  } = {},
): string {
  const v = opts.variant ?? 'primary';
  const s = opts.size ?? 'md';
  const t = opts.tone ?? 'dark';
  return [BASE, VARIANT[v], SIZE[s], FOCUS[t], opts.className ?? ''].filter(Boolean).join(' ');
}
