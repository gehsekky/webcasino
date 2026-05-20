/**
 * Deterministic name-derived avatar. No external service, no upload —
 * pure render-side. Same name → same color + initials every time, so
 * users get a stable visual identity across rooms and hands.
 *
 * AI seats get a robot glyph instead of initials so they're trivially
 * distinguishable from humans.
 */

type AvatarProps = {
  name: string;
  isAi?: boolean;
  /** Pixel size of the square. Defaults to 48. */
  size?: number;
};

function hashString(s: string): number {
  // Light non-cryptographic hash, just for color stability.
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function colorForName(name: string): string {
  const hue = hashString(name) % 360;
  // High saturation, mid-low lightness so white text reads on it.
  return `hsl(${hue}, 55%, 40%)`;
}

function initialsOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Avatar({ name, isAi = false, size = 48 }: AvatarProps) {
  const bg = isAi ? 'hsl(220, 15%, 35%)' : colorForName(name);
  const initials = initialsOf(name);
  return (
    <div
      role="img"
      aria-label={`avatar for ${name}${isAi ? ' (bot)' : ''}`}
      className="shrink-0 inline-flex items-center justify-center rounded-full font-bold text-white shadow-md ring-2 ring-emerald-700/40 select-none"
      style={{ width: size, height: size, backgroundColor: bg, fontSize: size * 0.4 }}
    >
      {isAi ? (
        <span aria-hidden="true" style={{ fontSize: size * 0.5 }}>
          ⚙
        </span>
      ) : (
        initials
      )}
    </div>
  );
}
