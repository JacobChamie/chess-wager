import { Link } from 'react-router-dom';

const Footer = () => {
  return (
    <footer className="site-footer">
      <div className="site-footer-grid">
        <div>
          <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>{'\u265A'}</span> ELO Stakes
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', maxWidth: '200px', lineHeight: 1.5 }}>
            Competitive chess with real stakes. Secured by multi-layer anti-cheat.
          </p>
        </div>

        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', marginBottom: '10px' }}>
            Platform
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <Link to="/" style={{ fontSize: '13px', color: 'var(--text-secondary)', textDecoration: 'none' }}>Play</Link>
            <Link to="/leaderboard" style={{ fontSize: '13px', color: 'var(--text-secondary)', textDecoration: 'none' }}>Leaderboard</Link>
            <Link to="/wallet" style={{ fontSize: '13px', color: 'var(--text-secondary)', textDecoration: 'none' }}>Wallet</Link>
          </div>
        </div>

        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', marginBottom: '10px' }}>
            Support
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <Link to="/faq" style={{ fontSize: '13px', color: 'var(--text-secondary)', textDecoration: 'none' }}>FAQ</Link>
            <Link to="/contact" style={{ fontSize: '13px', color: 'var(--text-secondary)', textDecoration: 'none' }}>Contact Us</Link>
          </div>
        </div>

        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', marginBottom: '10px' }}>
            Trust & Safety
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            <span>{'\uD83D\uDEE1\uFE0F'} Anti-cheat protected</span>
            <span>{'\uD83D\uDD12'} Encrypted transactions</span>
            <span>{'\u2713'} Fair play verified</span>
          </div>
        </div>
      </div>

      <div className="site-footer-meta">
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {'\u00A9'} {new Date().getFullYear()} ELO Stakes. All rights reserved.
        </span>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          v1.0
        </span>
      </div>
    </footer>
  );
};

export default Footer;
