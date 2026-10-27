import { motion } from "framer-motion";
import type { Activity } from "../activities/types";

/**
 * Compact pill content: glyph on the left, optional title in the middle, value on the right.
 *
 * @param props.activity The activity occupying the pill.
 */
export function CompactView({ activity }: { activity: Activity }) {
  const { Glyph, Trailing, Title, Progress, id, label } = activity;
  return (
    <div className="compact" role="status" aria-label={label}>
      <motion.span layoutId={`glyph-${id}`} className="compact-glyph" data-live-id={id}>
        <Glyph size={22} />
      </motion.span>
      {Title && (
        <span className="compact-title">
          <Title />
        </span>
      )}
      <span className="compact-value">
        <Trailing />
      </span>
      {Progress && <Progress />}
    </div>
  );
}
