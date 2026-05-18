/**
 * Toasts.jsx — bottom-corner non-blocking notifications.
 *
 * Why this exists: most successful actions in the app do their work
 * silently — adding tracks to a queue, saving to a playlist, removing
 * tracks from the library. With nothing to confirm the action
 * happened, the user is left wondering if it worked. Toasts give a
 * subtle, time-bound acknowledgement that doesn't block the UI.
 *
 * The system is intentionally tiny:
 *   - One `useToastBus()` hook owns the toast state + dispatch
 *   - One `<ToastStack />` renders the toasts in a fixed-position
 *     stack at the bottom of the viewport
 *   - Toasts auto-dismiss after `durationMs` (default 5 seconds) and
 *     can be manually dismissed by clicking
 *   - Each toast can have an `action` (label + handler) — used for
 *     undo. When clicked, the handler runs and the toast dismisses.
 *
 * Public surface:
 *   const { toasts, pushToast, dismissToast } = useToastBus();
 *
 *   pushToast({ message, kind, action?, durationMs? })
 *     - message:    string shown in the toast
 *     - kind:       'info' | 'success' | 'error'  (default 'info')
 *     - action:     { label, onClick }            (optional button)
 *     - durationMs: number                        (default 5000; pass
 *                                                 0 for sticky)
 *   Returns the toast id, in case the caller wants to dismiss it
 *   programmatically (e.g. when a follow-up action makes the toast
 *   stale before its timer fires).
 *
 *   dismissToast(id)
 *     - removes a toast, cancels its timer.
 *
 * Stylistically the toasts match the rest of the player chrome —
 * dark glass, light text, accent strip for the kind indicator. They
 * never use motion that competes with the music background — just
 * a quick slide-up-and-fade on enter, fade on exit.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_DURATION_MS = 5000;
const MAX_VISIBLE_TOASTS = 4;  // older toasts get auto-dismissed when this is exceeded

/**
 * State + dispatch for the toast system. The hook itself is
 * intentionally dumb — it doesn't know about the UI or auto-dismiss
 * timing; <ToastStack /> handles render + timer management.
 *
 * Returning the live array of toasts (not a context) lets us pass it
 * down to <ToastStack /> as a prop, which matches the rest of the
 * codebase's prop-drilling style.
 */
export function useToastBus() {
  const [toasts, setToasts] = useState([]);
  // Counter for unique ids — date-now collides when multiple toasts
  // arrive in the same millisecond (rare but possible in test
  // scenarios and rapid action loops).
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
      // 0 means "sticky" — no auto-dismiss. Used for errors that
      // require user attention.
      durationMs: typeof opts.durationMs === 'number' ? opts.durationMs : DEFAULT_DURATION_MS,
      createdAt: Date.now(),
    };
    setToasts((prev) => {
      const next = [...prev, toast];
      // Cap the visible stack — drop oldest first.
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

/**
 * Render the current toast stack. Auto-dismiss timers live here so
 * the bus hook stays state-only.
 *
 * Toasts render bottom-up (newest at the bottom of the stack) and
 * slide-in from below. Each one carries its own timer; clicking the
 * action button or the dismiss × cancels the timer immediately.
 *
 * Positioning: fixed at bottom-center, above the dock — the dock is
 * z:50 in this app's layering convention so we use z:60. On mobile-
 * sized viewports we shift slightly higher to clear the dock if it's
 * docked at the bottom edge.
 */
export function ToastStack({ toasts, onDismiss, accent = '128, 128, 128', bottomOffset = 88 }) {
  if (!toasts || toasts.length === 0) return null;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: bottomOffset,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
        maxWidth: 'min(440px, calc(100vw - 24px))',
        width: '100%',
        alignItems: 'center',
      }}
    >
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} onDismiss={onDismiss} accent={accent} />
      ))}
    </div>
  );
}

function ToastRow({ toast, onDismiss, accent }) {
  // Mount animation: starts off-screen + transparent, animates in on
  // first paint. The `mounted` flag flips inside a useEffect so the
  // browser has a chance to render the initial state before the
  // transition kicks in.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Auto-dismiss timer. 0 means sticky; non-zero schedules removal.
  // We don't pause on hover (could add it as a refinement) — the
  // duration is short enough that the user can re-trigger by repeating
  // the action if they miss it.
  useEffect(() => {
    if (toast.durationMs <= 0) return undefined;
    const id = setTimeout(() => onDismiss(toast.id), toast.durationMs);
    return () => clearTimeout(id);
  }, [toast.id, toast.durationMs, onDismiss]);

  // Kind-aware accent strip: success uses a green that complements
  // any cover accent; error uses the same red as the metadata-editor
  // delete state; info uses the player's accent colour so the toast
  // feels part of the current track's palette.
  const stripColor =
    toast.kind === 'success' ? '#7be191'
    : toast.kind === 'error' ? '#f37272'
    : `rgb(${accent})`;

  const handleAction = () => {
    if (!toast.action?.onClick) return;
    try { toast.action.onClick(); } catch (e) { console.error('toast action threw:', e); }
    onDismiss(toast.id);
  };

  return (
    <div
      style={{
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px 10px 16px',
        borderRadius: 12,
        background: 'rgba(20, 20, 22, 0.92)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.35)',
        color: 'rgba(255,255,255,0.92)',
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1.4,
        // Sliding into place. The transform here is added on top of
        // any parent transform, so we don't break the centering — the
        // parent uses `translateX(-50%)`, this row only translates Y.
        transform: mounted ? 'translateY(0)' : 'translateY(8px)',
        opacity: mounted ? 1 : 0,
        transition: 'transform 0.18s cubic-bezier(0.2, 0.7, 0.2, 1), opacity 0.18s',
        minWidth: 0,
        maxWidth: '100%',
      }}
    >
      {/* Kind indicator — a 3px vertical strip with the kind colour. */}
      <div style={{
        width: 3, alignSelf: 'stretch', borderRadius: 999,
        background: stripColor, flexShrink: 0, marginTop: 1, marginBottom: 1,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>{toast.message}</div>
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
            transition: 'background 0.12s, border-color 0.12s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.22)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)'; }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
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
