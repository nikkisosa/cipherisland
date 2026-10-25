import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Single-line text that scrolls back and forth when it is wider than its container.
 *
 * Text that fits is shown as is. Scrolling is disabled under `prefers-reduced-motion`.
 *
 * @param props.children The text.
 * @param props.className Extra class names for the container.
 */
export function Marquee({ children, className = "" }: { children: ReactNode; className?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    const measure = () => {
      if (box.current && text.current) setOverflow(Math.max(0, text.current.scrollWidth - box.current.clientWidth));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [children]);

  return (
    <span ref={box} className={`marquee ${className}`} data-scroll={overflow > 0}>
      <span
        ref={text}
        className="marquee-text"
        style={overflow > 0 ? ({ "--shift": `-${overflow + 8}px`, "--dur": `${Math.max(6, overflow / 14)}s` } as React.CSSProperties) : undefined}
      >
        {children}
      </span>
    </span>
  );
}
