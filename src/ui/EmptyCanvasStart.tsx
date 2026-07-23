export function EmptyCanvasStart({
  onPlaceBase,
  onPickTemplate,
}: {
  onPlaceBase: () => void;
  onPickTemplate: () => void;
}) {
  return (
    <div className="empty-start" role="region" aria-label="ロボット作りを始める">
      <div className="empty-start-card">
        <div className="empty-start-icon" aria-hidden="true">
          🔩
        </div>
        <h1>まず土台になるパーツを置こう</h1>
        <p>おすすめの「いた」から始めるか、できあがったロボットを改造できるよ。</p>
        <div className="empty-start-actions">
          <button className="toolbtn primary big" onClick={onPlaceBase}>
            ＋ おすすめの土台を置く
          </button>
          <button className="toolbtn big" onClick={onPickTemplate}>
            🤖 ひながたから始める
          </button>
        </div>
        <div className="empty-start-hint">まちがえても ↶ でもとに戻せるよ</div>
      </div>
    </div>
  );
}
