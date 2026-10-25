import type { Activity, ActivityId } from "../activities/types";

/** Props of [ExpandedView]. */
interface Props {
  tabs: Activity[];
  active: Activity;
  onSelect: (id: ActivityId) => void;
}

/**
 * Expanded content: the active activity's panel and, when there is more than one tab, a tab strip.
 *
 * @param props.tabs Activities that have a tab.
 * @param props.active The activity whose panel is shown.
 * @param props.onSelect Called with an activity id when its tab is clicked.
 */
export function ExpandedView({ tabs, active, onSelect }: Props) {
  const { Expanded } = active;
  return (
    <div className="expanded">
      <div className="expanded-body" style={{ height: active.expandedHeight }}>
        <Expanded />
      </div>
      {tabs.length > 1 && (
        <div className="tabs" role="tablist" aria-label="Activities">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className="tab"
              aria-selected={t.id === active.id}
              aria-label={t.label}
              title={t.label}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(t.id);
              }}
            >
              <t.Glyph size={16} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
