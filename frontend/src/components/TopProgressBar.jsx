import React from 'react';

const TopProgressBar = ({ active }) =>
  active ? (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-[2px] overflow-hidden" style={{ background: '#fde8c8' }}>
      <div className="h-full w-2/5" style={{ background: '#E88A1A', animation: 'topbar-slide 1.4s ease-in-out infinite' }} />
    </div>
  ) : null;

export default TopProgressBar;
