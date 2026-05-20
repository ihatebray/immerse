/**
 * Toasts.jsx — Symmetrical 3D Kinetic Notification Stack
 *
 * Implements a unified physics model where entrance and exit animations
 * perfectly mirror each other. Banners swing down out of a 3D perspective
 * plane on arrival, and snap smoothly back up into that exact same 3D 
 * plane upon dismissal, preventing any jarring layout snaps.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_DURATION_MS = 5000;
const MAX_VISIBLE_TOASTS = 4;

export function useToastBus() {
  const [toasts, setToasts] = useState([]);
  const counterRef = useRef(0);

  const pushToast = useCallback((opts) => {
    if (!opts || !opts.message) return null;
    counterRef.current += 1;
    const id = `toast_${Date.now()}_${counterRef.current}`;
    const toast = {
      id,
      message: String(opts.message),
      kind: opts.kind || 'info',
      action: opts.action || null,
      durationMs: typeof opts.durationMs === 'number' ? opts.durationMs : DEFAULT_DURATION_MS,
      createdAt: Date.now(),
    };
    setToasts((prev) => {
      const next = [...prev, toast];
      if (next.length > MAX_VISIBLE_TOASTS) {
        return next.slice(next.length - MAX_VISIBLE_TOASTS);
      }
      return next;
    });
    return id;
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, pushToast, dismissToast };
}

export function ToastStack({ toasts, onDismiss, pushToast, accent = '128, 128, 128', topOffset = 24, showDebugger = true }) {
  return (
    <>
      <div
        style={{
          position: 'fixed',
          top: topOffset,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 60,
          display: 'flex',
          flexDirection: 'column-reverse', 
          gap: 10,
          pointerEvents: 'none',
          maxWidth: 'min(440px, calc(100vw - 24px))',
          width: '100%',
          alignItems: 'center',
          perspective: '1200px',
        }}
      >
        {toasts && toasts.map((t) => (
          <ToastRow key={t.id} toast={t} onDismiss={onDismiss} accent={accent} />
        ))}
      </div>

      {/* FLOATING TESTER CONTROLS */}
      {showDebugger && pushToast && (
        <ToastDebugger pushToast={pushToast} />
      )}
    </>
  );
}

function ToastRow({ toast, onDismiss, accent }) {
  const [mounted, setMounted] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const exitTimeoutRef = useRef(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const handleDismiss = useCallback(() => {
    if (isExiting) return;
    setIsExiting(true);
    // Matches the duration of our master transition perfectly (320ms)
    exitTimeoutRef.current = setTimeout(() => {
      onDismiss(toast.id);
    }, 320);
  }, [isExiting, onDismiss, toast.id]);

  useEffect(() => {
    if (toast.durationMs <= 0) return undefined;
    const id = setTimeout(() => handleDismiss(), toast.durationMs);
    return () => clearTimeout(id);
  }, [toast.id, toast.durationMs, handleDismiss]);

  useEffect(() => {
    return () => {
      if (exitTimeoutRef.current) clearTimeout(exitTimeoutRef.current);
    };
  }, []);

  const stripColor =
    toast.kind === 'success' ? '#7be191'
    : toast.kind === 'error' ? '#f37272'
    : `rgb(${accent})`;

  const handleAction = () => {
    if (!toast.action?.onClick) return;
    try { toast.action.onClick(); } catch (e) { console.error('toast action threw:', e); }
    handleDismiss();
  };

  // --- UNIFIED KINETIC STATES ---
  // The unmounted state and the exiting state now share the exact same aesthetic coordinates,
  // making the animation completely loopable and symmetrical.
  const states = {
    initial: {
      transform: 'translateY(-40px) scale(0.88, 0.5) rotateX(-45deg)',
      opacity: 0,
      filter: 'blur(12px)',
      maxHeight: '100px',
      padding: '10px 14px 10px 16px',
      gap: 12
    },
    active: {
      transform: 'translateY(0) scale(1) rotateX(0deg)',
      opacity: 1,
      filter: 'blur(0px)',
      maxHeight: '100px',
      padding: '10px 14px 10px 16px',
      gap: 12
    },
    exit: {
      // Pulls perfectly back up into the ceiling plane
      transform: 'translateY(-40px) scale(0.88, 0.5) rotateX(-45deg)',
      opacity: 0,
      filter: 'blur(12px)',
      // Margins and heights collapse alongside the 3D retreat to smoothly slide up items below it
      maxHeight: '0px',
      padding: '0px 14px',
      gap: 0
    }
  };

  const currentStyle = isExiting ? states.exit : (mounted ? states.active : states.initial);

  // A beautiful, highly-damped spring curve that works perfectly both forward and backward
  const cubicCurve = 'cubic-bezier(0.25, 1, 0.5, 1)';
  const masterTransition = `
    transform 0.32s ${cubicCurve}, 
    opacity 0.28s linear, 
    filter 0.28s ease, 
    max-height 0.32s ${cubicCurve}, 
    padding 0.32s ${cubicCurve},
    gap 0.32s ${cubicCurve}
  `;

  // Interior layer timings
  const interiorTransform = isExiting 
    ? 'translateY(-6px)' 
    : (mounted ? 'translateY(0)' : 'translateY(6px)');
  
  const interiorTransition = `transform 0.3s ${cubicCurve}, opacity 0.25s ease`;

  return (
    <div
      style={{
        pointerEvents: isExiting ? 'none' : 'auto',
        display: 'flex',
        alignItems: 'center',
        borderRadius: 13,
        background: 'rgba(20, 20, 22, 0.85)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: isExiting ? '1px solid rgba(255,255,255,0)' : '1px solid rgba(255,255,255,0.09)',
        boxShadow: isExiting ? '0 0px 0px rgba(0,0,0,0)' : '0 12px 36px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.25)',
        color: 'rgba(255,255,255,0.95)',
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1.4,
        minWidth: 0,
        maxWidth: '100%',
        overflow: 'hidden',
        
        transformOrigin: 'top center',
        transition: masterTransition,
        ...currentStyle
      }}
    >
      {/* Kind indicator strip */}
      <div style={{
        width: 3, alignSelf: 'stretch', borderRadius: 999,
        background: stripColor, flexShrink: 0, marginTop: 1, marginBottom: 1,
        opacity: mounted && !isExiting ? 1 : 0,
        transform: mounted && !isExiting ? 'scaleY(1)' : 'scaleY(0.1)',
        transition: `transform 0.3s ${cubicCurve}, opacity 0.2s ease`,
      }} />

      {/* Message Text */}
      <div style={{ 
        flex: 1, 
        minWidth: 0,
        opacity: mounted && !isExiting ? 1 : 0,
        transform: interiorTransform,
        transition: interiorTransition
      }}>
        {toast.message}
      </div>

      {/* Action Button */}
      {toast.action ? (
        <button
          type="button"
          onClick={handleAction}
          style={{
            padding: '5px 10px',
            borderRadius: 7,
            border: '1px solid rgba(255,255,255,0.14)',
            background: 'rgba(255,255,255,0.04)',
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            flexShrink: 0,
            whiteSpace: 'nowrap',
            opacity: mounted && !isExiting ? 1 : 0,
            transform: interiorTransform,
            transition: `${interiorTransition}, background 0.12s, border-color 0.12s`,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.22)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)'; }}
        >
          {toast.action.label}
        </button>
      ) : null}

      {/* Dismiss Button */}
      <button
        type="button"
        onClick={handleDismiss}
        title="Dismiss"
        style={{
          padding: 0,
          width: 22, height: 22,
          borderRadius: 6,
          border: 'none',
          background: 'transparent',
          color: 'rgba(255,255,255,0.5)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          opacity: mounted && !isExiting ? 1 : 0,
          transform: interiorTransform,
          transition: interiorTransition
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Standalone Testing Utility UI Component
 */
function ToastDebugger({ pushToast }) {
  const btnStyle = {
    padding: '6px 10px',
    borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.05)',
    color: 'rgba(255,255,255,0.8)',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  };

  const triggerTest = (type) => {
    if (type === 'success') {
      pushToast({
        message: "Added 'Midnight City' to your queue.",
        kind: 'success',
        action: { label: 'Undo', onClick: () => console.log('Undo triggered!') }
      });
    } else if (type === 'error') {
      pushToast({
        message: 'Failed to update playlist. Connection lost.',
        kind: 'error',
        durationMs: 0
      });
    } else {
      pushToast({
        message: 'Syncing music library with cloud backup...',
        kind: 'info'
      });
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '10px',
        borderRadius: '12px',
        background: 'rgba(15, 15, 17, 0.85)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '9px', fontWeight: '700', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: '2px', textAlign: 'center' }}>
        Toast Engine Lab
      </div>
      <button type="button" style={btnStyle} onClick={() => triggerTest('success')} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(123, 225, 145, 0.15)'} onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}>
        💥 Test Success
      </button>
      <button type="button" style={btnStyle} onClick={() => triggerTest('info')} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'} onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}>
        ✨ Test Info
      </button>
      <button type="button" style={btnStyle} onClick={() => triggerTest('error')} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(243, 114, 114, 0.15)'} onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}>
        🚨 Test Error
      </button>
    </div>
  );
}