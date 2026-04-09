import { Link } from 'react-router-dom';

const Footer = () => {
  return (
    <footer className="site-footer">
      <div className="site-footer-grid">
        <div className="site-footer-brand">
          <div className="site-footer-title">
            <span>{'\u265A'}</span> ELO Stakes
          </div>
          <p className="site-footer-copy">
            Competitive chess with real stakes. Secured by multi-layer anti-cheat.
          </p>
        </div>

        <div className="site-footer-section">
          <div className="site-footer-heading">
            Platform
          </div>
          <div className="site-footer-links">
            <Link to="/" className="site-footer-link">Play</Link>
            <Link to="/leaderboard" className="site-footer-link">Leaderboard</Link>
            <Link to="/wallet" className="site-footer-link">Wallet</Link>
          </div>
        </div>

        <div className="site-footer-section">
          <div className="site-footer-heading">
            Support
          </div>
          <div className="site-footer-links">
            <Link to="/faq" className="site-footer-link">FAQ</Link>
            <Link to="/contact" className="site-footer-link">Contact Us</Link>
          </div>
        </div>

        <div className="site-footer-section">
          <div className="site-footer-heading">
            Trust & Safety
          </div>
          <div className="site-footer-links site-footer-links--static">
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
