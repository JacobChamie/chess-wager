import { useEffect, useState } from 'react';

const PARTICLE_COUNT = 20;

const blueShades = ['#64b5f6', '#42a5f5', '#2196f3', '#1e88e5'];
const redShades = ['#ef5350', '#e53935', '#f44336', '#c62828'];

const ConfettiOverlay = ({ targetColor }) => {
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
    }));
    setParticles(ps);
  }, [targetColor]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
        overflow: 'hidden',
      }}
    >
      {particles.map((p) => (
        <div
          key={p.id}
          className="confetti-particle"
          style={{
            position: 'absolute',
            left: `${p.left}%`,
            top: '-10px',
            width: `${p.size}px`,
            height: `${p.size}px`,
            backgroundColor: p.color,
            borderRadius: Math.random() > 0.5 ? '50%' : '2px',
            transform: `rotate(${p.rotation}deg)`,
            animation: `confettiFall ${p.duration}s ease-in ${p.delay}s forwards`,
          }}
        />
      ))}
    </div>
  );
};

export default ConfettiOverlay;
