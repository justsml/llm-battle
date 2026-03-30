"use client";

type BattleStatusStripProps = {
  activeCount: number;
  cardCount: number;
  costLabel: string;
  headline: string;
  tokenLabel: string;
};

export function BattleStatusStrip({
  activeCount,
  cardCount,
  costLabel,
  headline,
  tokenLabel,
}: BattleStatusStripProps) {
  return (
    <div className="status-strip-dock">
      <section className="status-strip glass-shell rise-in mx-auto max-w-[1600px]">
        <div className="status-strip__intro">
          <p className="status-strip__eyebrow">Run totals</p>
          <p className="status-strip__headline">{headline}</p>
        </div>

        <div className="status-strip__stats">
          <div className="status-strip__stat">
            <span className="status-strip__label">Cards</span>
            <strong className="status-strip__value">
              {activeCount}/{cardCount}
            </strong>
          </div>
          <div className="status-strip__stat">
            <span className="status-strip__label">Total tokens</span>
            <strong className="status-strip__value">{tokenLabel}</strong>
          </div>
          <div className="status-strip__stat">
            <span className="status-strip__label">Total cost</span>
            <strong className="status-strip__value">{costLabel}</strong>
          </div>
        </div>
      </section>
    </div>
  );
}
