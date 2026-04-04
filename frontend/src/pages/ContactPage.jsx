import { useState } from 'react';

const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

const ContactPage = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('general');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    // For now, show confirmation. Backend endpoint can be added later.
    setSubmitted(true);
  };

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '40px 20px 80px' }}>
      <h1 style={{ fontSize: '28px', fontWeight: 800, marginBottom: '8px', textAlign: 'center' }}>
        Contact Us
      </h1>
      <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '15px', marginBottom: '40px' }}>
        Have a question, issue, or suggestion? We'd love to hear from you.
      </p>

      {submitted ? (
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '40px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '40px', marginBottom: '16px' }}>{'\u2713'}</div>
          <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>Message Received</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px' }}>
            Thank you for reaching out. We'll get back to you as soon as possible.
          </p>
          <button className="btn btn-ghost" onClick={() => setSubmitted(false)}>
            Send Another Message
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '28px',
        }}>
          <div className="form-group">
            <label className="form-label">Name</label>
            <input
              className="input"
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              className="input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Subject</label>
            <select
              className="select"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            >
              <option value="general">General Inquiry</option>
              <option value="support">Technical Support</option>
              <option value="billing">Billing & Withdrawals</option>
              <option value="fairplay">Fair Play & Anti-Cheat</option>
              <option value="feedback">Feedback & Suggestions</option>
              <option value="partnership">Partnership</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Message</label>
            <textarea
              className="input"
              placeholder="Describe your question or issue..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              rows={5}
              style={{ resize: 'vertical', minHeight: '120px' }}
            />
          </div>

          <button
            className="btn btn-primary"
            type="submit"
            style={{ width: '100%' }}
            disabled={!name.trim() || !email.trim() || !message.trim()}
          >
            Send Message
          </button>
        </form>
      )}

      <div style={{
        marginTop: '32px',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '24px',
      }}>
        <h3 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '16px' }}>Other Ways to Reach Us</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px', color: 'var(--text-secondary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '16px' }}>{'\u2709'}</span>
            <span>support@elostakes.com</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '16px' }}>{'\uD83D\uDCAC'}</span>
            <span>Use the in-app global chat for quick questions</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '16px' }}>{'\u23F0'}</span>
            <span>Typical response time: within 24 hours</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContactPage;
