const DIFFICULTY_COLORS = {
  beginner: '#66bb6a',
  easy: '#81c784',
  medium: '#ffa726',
  hard: '#ef5350',
  expert: '#ab47bc',
  master: '#e53935',
};

const BotCard = ({ bot, selected, onClick }) => (
  <div
    className={`tc-tile${selected ? ' selected' : ''}`}
    onClick={onClick}
    style={{ padding: '10px 12px', textAlign: 'left', cursor: 'pointer' }}
  >
    <span className="tc-label" style={{ fontSize: '14px' }}>{bot.name}</span>
    <span
      className="tc-category"
      style={{ color: DIFFICULTY_COLORS[bot.id] || 'var(--text-secondary)' }}
    >
      {bot.title} ~{bot.rating}
    </span>
  </div>
);

export default BotCard;
