import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * Tooltip — wraps any child element and shows a styled glass tooltip on
 * hover after a short delay. Replaces the native browser `title=""`
 * tooltip everywhere it was visually jarring (transport buttons, dock
 * bar buttons, etc.). Native `title=""` still works fine for things like
 * truncated track row text where free OS tooltips are appropriate.
 *
 * Behavior:
 *   - 400ms hover delay before appearing (matches OS tooltip timing so
 *     the user doesn't get spammed with tooltips while skimming)
 *   - 120ms fade-in
 *   - Disappears immediately on mouse-leave (no exit fade — feels snappier)
 *   - Auto-flips above the target if the target is in the bottom 30% of
 *     the viewport (avoids the tooltip getting clipped at the screen edge)
 *   - Only one tooltip visible at a time; the wrapper component is
 *     stateful per-instance, but mouse-leave cancels pending appearances
 *
 * Usage:
 *   <Tooltip label="Shuffle"><button>...</button></Tooltip>
 *
 * Or for components that already accept a `title` prop, integrate the
 * Tooltip rendering inside the component itself (see BottomDockBtn).
 */
function Tooltip({ label, children, side = 'auto', delay = 400 }) {
  const wrapRef = useRef(null);
  const timerRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: '100%', bottom: 'auto', marginTop: 6, marginBottom: 0 });

  const show = () => {
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      // At the moment of appearance, decide above-or-below based on
      // viewport position. If the target is in the bottom third, flip up.
      if (wrapRef.current && side === 'auto') {
        const rect = wrapRef.current.getBoundingClientRect();
        const viewportH = window.innerHeight || document.documentElement.clientHeight;
        if (rect.bottom > viewportH * 0.7) {
          setPosition({ top: 'auto', bottom: '100%', marginTop: 0, marginBottom: 6 });
        } else {
          setPosition({ top: '100%', bottom: 'auto', marginTop: 6, marginBottom: 0 });
        }
      } else if (side === 'top') {
        setPosition({ top: 'auto', bottom: '100%', marginTop: 0, marginBottom: 6 });
      }
      setVisible(true);
      timerRef.current = null;
    }, delay);
  };

  const hide = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setVisible(false);
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  if (!label) return children;

  return (
    <span
      ref={wrapRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onMouseDown={hide}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
    >
      {children}
      {visible ? (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            top: position.top, bottom: position.bottom,
            left: '50%',
            transform: 'translateX(-50%)',
            marginTop: position.marginTop, marginBottom: position.marginBottom,
            padding: '5px 9px',
            borderRadius: 7,
            background: 'rgba(18, 18, 20, 0.94)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 8px 22px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)',
            color: '#fff',
            fontSize: 10.5, fontWeight: 600, letterSpacing: '0.02em',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 100,
            animation: 'imm-tt-in 120ms ease-out',
            WebkitFontSmoothing: 'antialiased',
            backfaceVisibility: 'hidden',
          }}
        >
          <style>{`
            @keyframes imm-tt-in {
              from { opacity: 0; transform: translateX(-50%) translateY(${position.bottom === 'auto' ? '-3px' : '3px'}); }
              to   { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
          `}</style>
          {label}
        </span>
      ) : null}
    </span>
  );
}

/**
 * HeartSlider — the seek bar / volume slider with a heart-shaped thumb.
 *
 * Click-to-jump and drag-to-scrub both supported. While dragging, the
 * value is reported live so the underlying audio (or volume) updates in
 * real time. The heart thumb is an inline SVG positioned by left%, scaling
 * up slightly on hover/drag so the user knows it's grabbable.
 *
 * Props:
 *   value      — current value (0..max)
 *   max        — upper bound. If 0 / falsy, the slider becomes inert.
 *   onChange   — fn(newValue) called continuously during drag and on click.
 *                Called as the user drags so audio/volume tracks the cursor.
 *   accent     — RGB string used to tint the filled portion + thumb.
 *   ariaLabel  — accessibility label
 *   thumbSize  — thumb width/height in px (default 12)
 *   thumbShape — either 'heart' or 'circle'; the heart is the default.
 */
function HeartSlider({ value = 0, max = 0, onChange, accent = '255, 255, 255', ariaLabel = 'Slider', thumbSize = 12, thumbShape = 'heart' }) {
  const trackRef = useRef(null);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);

  const safeMax = max > 0 ? max : 1;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));
  const inert = !max;

  // Convert pointer X to a value within [0, max]. Clamped so dragging
  // outside the track bounds still produces in-range values.
  const valueFromEvent = useCallback((clientX) => {
    if (!trackRef.current || !max) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * max;
  }, [max]);

  const handlePointerDown = (e) => {
    if (inert) return;
    e.preventDefault();
    // Use pointer capture so we keep getting move/up events even if the
    // pointer leaves the track. setPointerCapture on the track element.
    try { trackRef.current?.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    setDragging(true);
    onChange?.(valueFromEvent(e.clientX));
  };

  const handlePointerMove = (e) => {
    if (!dragging) return;
    onChange?.(valueFromEvent(e.clientX));
  };

  const handlePointerUp = (e) => {
    if (!dragging) return;
    setDragging(false);
    try { trackRef.current?.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
  };

  const handleKey = (e) => {
    if (inert) return;
    const step = max / 100; // 1% steps for keyboard
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange?.(Math.min(max, value + step));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange?.(Math.max(0, value - step));
    } else if (e.key === 'Home') {
      e.preventDefault(); onChange?.(0);
    } else if (e.key === 'End') {
      e.preventDefault(); onChange?.(max);
    }
  };

  // Thumb visible when hovered or dragging — keeps the bar visually
  // minimal at rest (Spotify-style) and reveals the heart on intent.
  const thumbVisible = hovered || dragging;
  const thumbScale = dragging ? 1.25 : (hovered ? 1.1 : 1);

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={inert ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={max || 1}
      aria-valuenow={value}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={handleKey}
      style={{
        flex: 1, height: 16, position: 'relative', display: 'flex', alignItems: 'center',
        cursor: inert ? 'default' : 'pointer',
        // Prevent text-selection / image-drag mid-drag
        userSelect: 'none', WebkitUserSelect: 'none',
        outline: 'none',
        // Subtle focus ring via box-shadow on hover only — full focus
        // would clash with the cover canvas.
        touchAction: 'none',
      }}
    >
      {/* Track (background) */}
      <div style={{
        position: 'absolute', left: 0, right: 0, height: 2, top: '50%', marginTop: -1,
        background: 'rgba(255,255,255,0.14)', borderRadius: 2,
        transition: 'height 0.15s',
      }} />
      {/* Filled portion */}
      <div style={{
        position: 'absolute', left: 0, width: `${pct}%`, height: 2, top: '50%', marginTop: -1,
        background: thumbVisible ? `rgba(${accent}, 1)` : 'rgba(255,255,255,0.95)',
        borderRadius: 2, maxWidth: '100%',
        // Smoothly interpolate the fill between the (coarse) time updates so
        // the playhead glides instead of stepping. Disabled while dragging so
        // a manual seek tracks the pointer with zero lag.
        transition: dragging ? 'background 0.18s' : 'width 0.18s linear, background 0.18s',
        // Slight glow when grabbing so the bar feels alive
        boxShadow: dragging ? `0 0 8px rgba(${accent}, 0.45)` : 'none',
      }} />
      {/* Heart thumb. Positioned by left% with translate to center. SVG
          is filled with the accent color when active, white otherwise.
          Scale animation gives it a "pop" on grab. */}
      <div style={{
        position: 'absolute',
        left: `${pct}%`,
        top: '50%',
        transform: `translate(-50%, -50%) scale(${thumbScale})`,
        opacity: thumbVisible ? 1 : 0,
        transition: dragging
          ? 'opacity 0.18s ease, transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)'
          : 'opacity 0.18s ease, transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), left 0.18s linear',
        pointerEvents: 'none',
        // Tiny drop-shadow so the heart reads against any cover-art color
        filter: dragging
          ? `drop-shadow(0 2px 4px rgba(0,0,0,0.5)) drop-shadow(0 0 6px rgba(${accent}, 0.6))`
          : 'drop-shadow(0 1px 3px rgba(0,0,0,0.45))',
      }}>
        <svg
          width={thumbSize} height={thumbSize}
          viewBox="0 0 24 24"
          fill={dragging ? `rgb(${accent})` : '#fff'}
          stroke={thumbShape === 'circle' ? 'rgba(255,255,255,0.7)' : 'none'}
          strokeWidth={thumbShape === 'circle' ? 1.5 : 0}
          aria-hidden
          style={{ display: 'block' }}
        >
          {thumbShape === 'circle' ? (
            <circle cx="12" cy="12" r="8" />
          ) : (
            <path d="M12 21s-7-4.35-9.5-8.5C.92 9.4 2.18 5 6 5c2.04 0 3.4 1.13 4.5 2.5C11.6 6.13 12.96 5 15 5c3.82 0 5.08 4.4 3.5 7.5C19 16.65 12 21 12 21z" />
          )}
        </svg>
      </div>
    </div>
  );
}


/**
 * ExplicitBadge — small "E" indicator that appears next to a track title when
 * the streaming service flagged the song as explicit. Inline-block, ~14px
 * square, white text on a translucent dark plate. Only shown when
 * `track.explicit === 1`; we deliberately don't show a "clean" badge for
 * `=== 0` because the absence of the E is itself the signal.
 */
function ExplicitBadge() {
  return (
    <span
      title="Explicit"
      aria-label="Explicit lyrics"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 14, height: 14, borderRadius: 3,
        background: 'rgba(255, 255, 255, 0.18)',
        color: 'rgba(255, 255, 255, 0.85)',
        fontSize: 8.5, fontWeight: 700, letterSpacing: '-0.02em',
        flexShrink: 0,
        lineHeight: 1, paddingTop: 1,
        userSelect: 'none',
      }}
    >E</span>
  );
}


function GhostBtn({ children, onClick, title, active, size = 36 }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: size, height: size, borderRadius: '50%', border: 'none', background: 'transparent',
        color: active ? '#fff' : hov ? '#fff' : 'rgba(255,255,255,0.65)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', padding: 0, transition: 'color 0.16s',
      }}
    >
      {active ? (
        <span
          aria-hidden
          style={{
            position: 'absolute', bottom: 2, width: 3, height: 3, borderRadius: '50%', background: '#fff',
          }}
        />
      ) : null}
      {children}
    </button>
  );
}

/** Skip button (prev/next) — thin line icon, just brightens on hover. */
function MediaSkipBtn({ children, onClick, title }) {
  const [hov, setHov] = useState(false);
  return (
    <Tooltip label={title} side="top">
      <button type="button" onClick={onClick} aria-label={title}
        onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
        style={{
          width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'transparent',
          color: hov ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.75)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, transition: 'color 0.2s, transform 0.15s',
          transform: hov ? 'scale(1.08)' : 'scale(1)',
        }}>
        {children}
      </button>
    </Tooltip>
  );
}

/** Play/pause button — no circle, just the rounded-triangle outline (larger than skip buttons). */
function MediaPlayPauseBtn({ onClick, isPlaying }) {
  const [hov, setHov] = useState(false);
  const label = isPlaying ? 'Pause' : 'Play';
  return (
    <Tooltip label={label} side="top">
      <button type="button" onClick={onClick} aria-label={label}
        onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
        style={{
          width: 56, height: 56, borderRadius: '50%',
          border: 'none', background: 'transparent',
          color: hov ? '#fff' : 'rgba(255,255,255,0.85)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0,
          transition: 'color 0.2s, transform 0.15s',
          transform: hov ? 'scale(1.08)' : 'scale(1)',
          flexShrink: 0,
        }}>
        {isPlaying ? (
          /* Pause — filled rounded pills */
          <svg width="38" height="38" viewBox="0 0 32 32" fill="currentColor">
            <rect x="10.5" y="7" width="4" height="18" rx="2" />
            <rect x="17.5" y="7" width="4" height="18" rx="2" />
          </svg>
        ) : (
          /* Play — filled rounded triangle (no circle behind, matches v2 reference) */
          <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 2 }}>
            <path d="M8 5.6c-1.4-1-3.5 0-3.5 1.7v9.4c0 1.75 2.1 2.75 3.5 1.7l8-5c1.4-.85 1.4-2.65 0-3.5l-8-4.3z" />
          </svg>
        )}
      </button>
    </Tooltip>
  );
}

/** Toggle button (shuffle/repeat) — bare icon with active dot under it. */
function MediaToggleBtn({ children, onClick, title, active }) {
  const [hov, setHov] = useState(false);
  return (
    <Tooltip label={title} side="top">
      <button type="button" onClick={onClick} aria-label={title}
        onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
        style={{
          width: 32, height: 40, border: 'none', background: 'transparent',
          color: active ? '#fff' : hov ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.55)',
          cursor: 'pointer', padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'color 0.2s',
          position: 'relative',
        }}>
        {children}
        {/* Active dot indicator below icon */}
        {active ? (
          <span aria-hidden style={{
            position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)',
            width: 3, height: 3, borderRadius: '50%',
            background: '#fff',
          }} />
        ) : null}
      </button>
    </Tooltip>
  );
}

/**
 * ImmerseTooltipLayer — a single app-wide layer that replaces EVERY native
 * browser `title=""` tooltip with the Immerse glass style, without touching
 * any call site. Mount it once near the app root.
 *
 * How it works: it listens (capture phase) for hover on any element carrying
 * a `title`. On hover it stashes the title in `data-imm-title` and removes the
 * `title` attribute (so the OS tooltip never appears), waits the usual delay,
 * then renders a styled tooltip positioned over the element via a portal. On
 * mouse-leave / scroll / mousedown it restores the `title` and hides.
 *
 * The explicit <Tooltip> wrapper (used for the dock / transport buttons) sets
 * no native `title`, so the two never collide — both render the same look.
 */
function ImmerseTooltipLayer() {
  const [tip, setTip] = useState(null);
  const timerRef = useRef(null);
  const elRef = useRef(null);

  useEffect(() => {
    const DELAY = 400;
    const clear = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };
    const findTitled = (node) => {
      let el = node;
      while (el && el.nodeType === 1 && el !== document.body) {
        if (el.getAttribute && el.getAttribute('title')) return el;
        el = el.parentElement;
      }
      return null;
    };
    const restore = (el) => {
      if (el && el.dataset && el.dataset.immTitle != null) {
        el.setAttribute('title', el.dataset.immTitle);
        delete el.dataset.immTitle;
      }
    };
    const hide = () => {
      clear();
      if (elRef.current) { restore(elRef.current); elRef.current = null; }
      setTip(null);
    };
    const onOver = (e) => {
      const el = findTitled(e.target);
      if (!el || el === elRef.current) return;
      hide();
      const text = el.getAttribute('title');
      if (!text) return;
      el.dataset.immTitle = text;        // stash + suppress native tooltip
      el.removeAttribute('title');
      elRef.current = el;
      clear();
      timerRef.current = setTimeout(() => {
        if (elRef.current !== el || !el.isConnected) { hide(); return; }
        const r = el.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        const above = r.bottom > vh * 0.7;
        const x = Math.min(Math.max(r.left + r.width / 2, 60), vw - 60);
        setTip({ text, x, y: above ? r.top - 6 : r.bottom + 6, above });
        timerRef.current = null;
      }, DELAY);
    };
    const onOut = (e) => {
      if (!elRef.current) return;
      const to = e.relatedTarget;
      if (to && elRef.current.contains && elRef.current.contains(to)) return;
      hide();
    };
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('mousedown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
      document.removeEventListener('mousedown', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
      clear();
      if (elRef.current) restore(elRef.current);
    };
  }, []);

  if (!tip) return null;
  return createPortal(
    <div role="tooltip" style={{
      position: 'fixed', left: tip.x, top: tip.y,
      transform: `translateX(-50%)${tip.above ? ' translateY(-100%)' : ''}`,
      padding: '5px 9px', borderRadius: 7,
      background: 'rgba(18, 18, 20, 0.94)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 8px 22px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)',
      color: '#fff', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.02em',
      maxWidth: 280, whiteSpace: 'normal', textAlign: 'center', lineHeight: 1.35,
      pointerEvents: 'none', zIndex: 100000,
      animation: 'imm-tt-in 120ms ease-out',
      WebkitFontSmoothing: 'antialiased',
    }}>
      <style>{`@keyframes imm-tt-in{from{opacity:0}to{opacity:1}}`}</style>
      {tip.text}
    </div>,
    document.body
  );
}

export { Tooltip, HeartSlider, ExplicitBadge, GhostBtn, MediaSkipBtn, MediaPlayPauseBtn, MediaToggleBtn, ImmerseTooltipLayer };
