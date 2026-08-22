import React from 'react';

export default function PasswordStrength({ password }) {
  if (!password) return null;

  let score = 0;
  if (password.length > 7) score += 1;
  if (password.length > 11) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  let color = '#EF4444'; // Red
  let text = 'Weak';
  
  if (score >= 3) {
    color = '#F59E0B'; // Yellow
    text = 'Medium';
  }
  if (score >= 4) {
    color = '#10B981'; // Green
    text = 'Strong';
  }

  const bars = [1, 2, 3, 4].map(i => (
    <div 
      key={i} 
      style={{
        height: '4px',
        flex: 1,
        borderRadius: '2px',
        background: i <= Math.min(score, 4) ? color : '#3A3B3C',
        transition: 'background 0.3s ease'
      }}
    />
  ));

  return (
    <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ display: 'flex', gap: '4px', flex: 1 }}>{bars}</div>
      <span style={{ fontSize: '12px', color: color, fontWeight: 500, minWidth: '45px', textAlign: 'right' }}>
        {text}
      </span>
    </div>
  );
}
