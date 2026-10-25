import type { SVGProps } from "react";

/** Props shared by all icons. `size` sets both width and height in pixels. */
interface IconProps extends Omit<SVGProps<SVGSVGElement>, "width" | "height"> {
  size?: number;
}

/**
 * Shared SVG wrapper for the icon set: 24x24 viewBox, `currentColor` stroke, decorative by default.
 *
 * The icons are original drawings in a line style similar to Fluent system icons.
 */
function Base({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Play triangle. */
export const PlayIcon = (p: IconProps) => (
  <Base {...p} fill="currentColor" stroke="currentColor" strokeWidth={1.2}>
    <path d="M8.5 5.8v12.4a.8.8 0 0 0 1.2.7l9.6-6.2a.8.8 0 0 0 0-1.4L9.7 5.1a.8.8 0 0 0-1.2.7z" />
  </Base>
);

/** Pause bars. */
export const PauseIcon = (p: IconProps) => (
  <Base {...p} fill="currentColor" stroke="none">
    <rect x="6.5" y="5" width="4" height="14" rx="1.2" />
    <rect x="13.5" y="5" width="4" height="14" rx="1.2" />
  </Base>
);

/** Skip to next track. */
export const NextIcon = (p: IconProps) => (
  <Base {...p} fill="currentColor" strokeWidth={1.2}>
    <path d="M5.5 6.3v11.4a.7.7 0 0 0 1.1.6l8-5.7a.7.7 0 0 0 0-1.2l-8-5.7a.7.7 0 0 0-1.1.6z" />
    <rect x="16.5" y="5.5" width="2.4" height="13" rx="1.1" stroke="none" />
  </Base>
);

/** Skip to previous track. */
export const PreviousIcon = (p: IconProps) => (
  <Base {...p} fill="currentColor" strokeWidth={1.2}>
    <path d="M18.5 6.3v11.4a.7.7 0 0 1-1.1.6l-8-5.7a.7.7 0 0 1 0-1.2l8-5.7a.7.7 0 0 1 1.1.6z" />
    <rect x="5.1" y="5.5" width="2.4" height="13" rx="1.1" stroke="none" />
  </Base>
);

/** Music note. */
export const MusicIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M9 17.5V6.2l10-2v11" />
    <circle cx="6.8" cy="17.6" r="2.4" fill="currentColor" />
    <circle cx="16.8" cy="15.6" r="2.4" fill="currentColor" />
  </Base>
);

/**
 * Speaker with sound waves.
 *
 * @param props.level Volume from 0 to 1; selects how many waves are drawn.
 * @param props.muted Draws a cross instead of waves.
 */
export function SpeakerIcon({ level = 1, muted = false, ...p }: IconProps & { level?: number; muted?: boolean }) {
  return (
    <Base {...p}>
      <path d="M4 9.6h3.2L12 5.6v12.8l-4.8-4H4z" fill="currentColor" />
      {muted ? (
        <path d="M16 9.5l5 5M21 9.5l-5 5" />
      ) : (
        <>
          {level > 0 && <path d="M15.4 9.4a3.6 3.6 0 0 1 0 5.2" />}
          {level > 0.45 && <path d="M18 6.9a7.2 7.2 0 0 1 0 10.2" />}
        </>
      )}
    </Base>
  );
}

/**
 * Battery outline with a fill.
 *
 * @param props.level Charge from 0 to 100; sets the fill width.
 * @param props.color Fill color.
 */
export function BatteryIcon({ level = 100, color = "currentColor", ...p }: IconProps & { level?: number; color?: string }) {
  const fill = Math.max(0, Math.min(100, level)) / 100;
  return (
    <Base {...p}>
      <rect x="2.5" y="7" width="16" height="10" rx="2.6" />
      <path d="M21 10.5v3" />
      <rect x="4.6" y="9.1" width={11.8 * fill} height="5.8" rx="1.1" fill={color} stroke="none" />
    </Base>
  );
}

/** Lightning bolt. */
export const BoltIcon = (p: IconProps) => (
  <Base {...p} fill="currentColor" strokeWidth={1}>
    <path d="M13.2 2.8 5.4 13.2a.5.5 0 0 0 .4.8H11l-1 6.2a.4.4 0 0 0 .7.3l7.9-10.4a.5.5 0 0 0-.4-.8H13l.9-6a.4.4 0 0 0-.7-.5z" />
  </Base>
);

/** Timer. */
export const TimerIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="13.4" r="7" />
    <path d="M12 9.6v4l2.6 1.6M9.6 3.6h4.8" />
  </Base>
);

/** Bell. */
export const BellIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M6.2 16.6V11a5.8 5.8 0 0 1 11.6 0v5.6l1.5 1.6H4.7z" />
    <path d="M10 20.4a2.2 2.2 0 0 0 4 0" />
  </Base>
);

/** Plus sign. */
export const PlusIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 5.5v13M5.5 12h13" />
  </Base>
);

/** Minus sign. */
export const MinusIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M5.5 12h13" />
  </Base>
);

/** Cross. */
export const CloseIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Base>
);

/** Clock face. */
export const ClockIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.2" />
    <path d="M12 7.4V12l3.2 2" />
  </Base>
);

/** Processor chip. */
export const ChipIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
    <rect x="10" y="10" width="4" height="4" rx="0.8" fill="currentColor" stroke="none" />
    <path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3" />
  </Base>
);

/** Clipboard. */
export const ClipboardIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="5.5" y="5" width="13" height="15.5" rx="2.2" />
    <path d="M9 5V4.2A1.2 1.2 0 0 1 10.2 3h3.6A1.2 1.2 0 0 1 15 4.2V5M8.8 11h6.4M8.8 14.5h4.2" />
  </Base>
);

/** Calendar. */
export const CalendarIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="4.5" y="5.5" width="15" height="14" rx="2.4" />
    <path d="M4.5 10h15M9 3.8v3.4M15 3.8v3.4" />
  </Base>
);

/** Four-square grid. */
export const GridIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="4.5" y="4.5" width="6" height="6" rx="1.6" />
    <rect x="13.5" y="4.5" width="6" height="6" rx="1.6" />
    <rect x="4.5" y="13.5" width="6" height="6" rx="1.6" />
    <rect x="13.5" y="13.5" width="6" height="6" rx="1.6" />
  </Base>
);

/** Padlock. */
export const LockIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="5.5" y="10.5" width="13" height="9.5" rx="2.2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Base>
);

/** Scissors. */
export const ScissorsIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="7" cy="7" r="2.4" />
    <circle cx="7" cy="17" r="2.4" />
    <path d="M8.9 8.5 19 16M8.9 15.5 19 8" />
  </Base>
);

/** Settings gear. */
export const GearIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.8v2.4M12 17.8v2.4M3.8 12h2.4M17.8 12h2.4M6.2 6.2l1.7 1.7M16.1 16.1l1.7 1.7M17.8 6.2l-1.7 1.7M7.9 16.1l-1.7 1.7" />
  </Base>
);

/** Activity pulse line. */
export const PulseIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M3.5 12.5h4l2.2-6 4 12 2.3-6h4.5" />
  </Base>
);

/** Arrow pointing up and to the right. */
export const ArrowUpRightIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M7.5 16.5 16.5 7.5M9 7.5h7.5V15" />
  </Base>
);
