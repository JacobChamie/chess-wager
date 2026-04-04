import { useState } from 'react';
import { Link } from 'react-router-dom';

const faqs = [
  {
    category: 'Getting Started',
    items: [
      {
        q: 'How do I start a game?',
        a: 'Sign up or log in, then head to the lobby. Choose a time control (Bullet, Blitz, Rapid, or Classical), optionally set a wager amount, and click "Play". You\'ll be matched with another player with the same time control and wager. You can also create a private game and share the link with a friend, or browse open games to join.',
      },
      {
        q: 'Do I need to deposit money to play?',
        a: 'No. You can play free games with no wager at any time. Wagers are optional and require a token balance, which you can fund via cryptocurrency deposits.',
      },
      {
        q: 'What time controls are available?',
        a: 'We offer Bullet (1-2 min), Blitz (3-5 min), Rapid (10-15 min), and Classical (30-60 min) presets, as well as custom time controls with optional increment.',
      },
      {
        q: 'Can I play against bots?',
        a: 'Yes. We offer bot opponents ranging from beginner (800 ELO) to master strength (3000 ELO). Bot games do not support wagers.',
      },
    ],
  },
  {
    category: 'Wagers & Payments',
    items: [
      {
        q: 'How do wagers work?',
        a: 'When both players agree to a wager amount, the tokens are locked before the game starts. The winner receives both wagers. In case of a draw, both players are refunded. Wager settlement is atomic and tamper-proof with row-level database locking.',
      },
      {
        q: 'What is the withdrawal fee?',
        a: 'A 3% fee is applied to all withdrawals to cover network gas fees and platform operating costs. Premium members and admins are exempt from this fee.',
      },
      {
        q: 'How do deposits work?',
        a: 'We support Ethereum (ETH, USDC) and Solana (SOL, USDC) deposits. Each user receives a unique deposit address. Once a transaction is confirmed on-chain, tokens are automatically credited to your account.',
      },
      {
        q: 'How long do withdrawals take?',
        a: 'Withdrawals are submitted for review and typically processed within 24 hours. You\'ll receive an email notification once your withdrawal has been sent.',
      },
    ],
  },
  {
    category: 'Fair Play & Anti-Cheat',
    items: [
      {
        q: 'How does your anti-cheat system work?',
        a: 'We use a multi-layered fair play system that combines real-time move analysis with post-game deep analysis. Our engine evaluates every move against top engine lines, computing metrics like Average Centipawn Loss (ACPL), engine correlation percentage, move timing patterns, and a composite trust score. Suspicious games are automatically flagged and held for manual review before wager payouts.',
      },
      {
        q: 'What happens if cheating is detected during a game?',
        a: 'If our live detection system flags suspicious play mid-game, the wager is placed on hold. After the game completes, a deep analysis is performed. If cheating is confirmed, the offending player\'s wager is forfeited and the opponent is refunded. Repeat offenders face account suspension.',
      },
      {
        q: 'What metrics do you use to detect engine use?',
        a: 'We analyze Average Centipawn Loss (ACPL), engine correlation (how often moves match the top engine choice), move strength distribution, timing patterns, and behavioral signals like tab-switching. These are combined into a trust score. Scores below the threshold trigger a flag.',
      },
      {
        q: 'Can I be falsely flagged?',
        a: 'Our system is calibrated to minimize false positives. Flagged games are always reviewed by our team before any action is taken. If you believe you were wrongly flagged, you can contact us and we\'ll investigate.',
      },
      {
        q: 'Do you support linked chess accounts for verification?',
        a: 'Yes. You can link your Lichess account to verify your rating. This can be used as a matchmaking gate to ensure fair pairings in wager games.',
      },
    ],
  },
  {
    category: 'Account & Security',
    items: [
      {
        q: 'Is my account secure?',
        a: 'Yes. Passwords are hashed with bcrypt, authentication uses JWT tokens, and all sensitive operations require email verification. We never store plaintext passwords or private keys.',
      },
      {
        q: 'What is Premium membership?',
        a: 'Premium members enjoy benefits including zero withdrawal fees, priority matchmaking, a gold username badge, and enhanced profile visibility on the leaderboard.',
      },
    ],
  },
];

const FAQItem = ({ q, a }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      borderBottom: '1px solid var(--border)',
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 0',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-primary)',
          fontSize: '15px',
          fontWeight: 600,
          fontFamily: 'inherit',
          textAlign: 'left',
          gap: '12px',
        }}
      >
        <span>{q}</span>
        <span style={{
          fontSize: '18px',
          color: 'var(--text-muted)',
          transform: open ? 'rotate(45deg)' : 'none',
          transition: 'transform var(--transition)',
          flexShrink: 0,
        }}>+</span>
      </button>
      {open && (
        <div style={{
          padding: '0 0 16px',
          fontSize: '14px',
          lineHeight: 1.7,
          color: 'var(--text-secondary)',
        }}>
          {a}
        </div>
      )}
    </div>
  );
};

const FAQPage = () => {
  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '40px 20px 80px' }}>
      <h1 style={{ fontSize: '28px', fontWeight: 800, marginBottom: '8px', textAlign: 'center' }}>
        Frequently Asked Questions
      </h1>
      <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '15px', marginBottom: '40px' }}>
        Everything you need to know about ELO Stakes.
      </p>

      {faqs.map((section) => (
        <div key={section.category} style={{ marginBottom: '32px' }}>
          <h2 style={{
            fontSize: '13px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '1px',
            color: 'var(--accent)',
            marginBottom: '8px',
          }}>
            {section.category}
          </h2>
          <div style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '0 20px',
          }}>
            {section.items.map((item, i) => (
              <FAQItem key={i} q={item.q} a={item.a} />
            ))}
          </div>
        </div>
      ))}

      <div style={{ textAlign: 'center', marginTop: '40px' }}>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '12px' }}>
          Still have questions?
        </p>
        <Link to="/contact" className="btn btn-ghost">
          Contact Us
        </Link>
      </div>
    </div>
  );
};

export default FAQPage;
