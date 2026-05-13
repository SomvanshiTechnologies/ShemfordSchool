import { useEffect, useState, useCallback, useRef } from 'react';

const isMobileDevice = () =>
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

// True when running inside a Capacitor native shell
const isNative = () => !!(window.Capacitor?.isNativePlatform?.());

export function useScreenshotPrevention() {
  const [isBlurred, setIsBlurred] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const blurTimerRef = useRef(null);
  const warningTimerRef = useRef(null);
  const isMobile = useRef(isMobileDevice());

  const triggerWarning = useCallback(() => {
    setIsBlurred(true);
    setShowWarning(true);
    clearTimeout(warningTimerRef.current);
    warningTimerRef.current = setTimeout(() => {
      setShowWarning(false);
      setIsBlurred(false);
    }, 2500);
  }, []);

  const applyBlur = useCallback(() => {
    clearTimeout(blurTimerRef.current);
    const delay = isMobile.current ? 300 : 100;
    blurTimerRef.current = setTimeout(() => setIsBlurred(true), delay);
  }, []);

  const removeBlur = useCallback((force = false) => {
    clearTimeout(blurTimerRef.current);
    if (force || !showWarning) setIsBlurred(false);
  }, [showWarning]);

  useEffect(() => {
    // Desktop keyboard shortcuts
    const handleKeyDown = (e) => {
      const isScreenshot =
        e.key === 'PrintScreen' ||
        e.key === 'F13' ||
        (e.metaKey && e.shiftKey && ['3', '4', '5'].includes(e.key)) ||
        (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's');
      if (isScreenshot) {
        e.preventDefault();
        e.stopPropagation();
        triggerWarning();
      }
    };

    // iOS native bridge: AppDelegate fires this event via evaluateJavaScript when
    // UIApplication.userDidTakeScreenshotNotification is received
    const handleNativeScreenshot = () => triggerWarning();

    // Blur when app goes to background (works on both web and Capacitor)
    const handleBlur = () => applyBlur();
    const handleFocus = () => { if (!showWarning) removeBlur(); };
    const handleVisibilityChange = () => {
      if (document.hidden) applyBlur();
      else if (!showWarning) removeBlur();
    };

    const handleContextMenu = (e) => e.preventDefault();

    // Prevent long-press save on media elements (mobile)
    const handleTouchStart = (e) => {
      if (['IMG', 'VIDEO', 'CANVAS'].includes(e.target.tagName)) {
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('screenshotTaken', handleNativeScreenshot); // iOS native bridge event
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('touchstart', handleTouchStart, { passive: false });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('screenshotTaken', handleNativeScreenshot);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('touchstart', handleTouchStart);
      clearTimeout(blurTimerRef.current);
      clearTimeout(warningTimerRef.current);
    };
  }, [triggerWarning, applyBlur, removeBlur, showWarning]);

  return { isBlurred, showWarning, isMobile: isMobile.current, isNative: isNative() };
}
