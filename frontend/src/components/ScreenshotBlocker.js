import React from 'react';
import { useScreenshotPrevention } from '../hooks/useScreenshotPrevention';

export default function ScreenshotBlocker({ children }) {
  const { isBlurred, showWarning } = useScreenshotPrevention();

  return (
    <div className="screenshot-blocker-root">
      <div
        className="screenshot-blocker-content"
        style={{ filter: isBlurred ? 'blur(20px)' : 'none' }}
      >
        {children}
      </div>

      {showWarning && (
        <div className="screenshot-warning-overlay">
          <div className="screenshot-warning-box">
            <div className="screenshot-warning-icon">&#128683;</div>
            <h2>Screenshot Blocked</h2>
            <p>Screenshots are not permitted in this application. All activity is monitored.</p>
          </div>
        </div>
      )}
    </div>
  );
}
