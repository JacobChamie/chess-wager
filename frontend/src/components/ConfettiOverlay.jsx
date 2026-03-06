import { useEffect, useState, memo } from 'react';

const PARTICLE_COUNT = 20;

const blueShades = ['#64b5f6', '#42a5f5', '#2196f3', '#1e88e5'];
const redShades = ['#ef5350', '#e53935', '#f44336', '#c62828'];

const ConfettiOverlay = memo(({ targetColor }) => {
  const [particles, setParticles] = useState([]);

  useEffect(() => {
    const colors = targetColor === 'w' ? blueShades : redShades;
    const ps = Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.5,
      duration: 1.5 + Math.random() * 1.5,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: 6 + Math.random() * 6,
      rotation: Math.random() * 360,
      isCircle: Math.random() > 0.5,
    }));
    setParticles(ps);
  }, [targetColor]);

  return (
    <div className="confetti-overlay">
      {particles.map((p) => (
        <div
          key={p.id}
          className="confetti-particle"
          style={{
            left: `${p.left}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            backgroundColor: p.color,
            borderRadius: p.isCircle ? '50%' : '2px',
            transform: `rotate(${p.rotation}deg)`,
            animation: `confettiFall ${p.duration}s ease-in ${p.delay}s forwards`,
          }}
        />
      ))}
    </div>
  );
});

ConfettiOverlay.displayName = 'ConfettiOverlay';

export default ConfettiOverlay;
