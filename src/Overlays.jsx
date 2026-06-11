import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Shuffle, Repeat, Repeat1 } from 'lucide-react';
import Icons from './Icons.jsx';
import { formatTime } from './mediaUtils.js';
import { HeartSlider, MediaPlayPauseBtn, MediaToggleBtn, MediaSkipBtn } from './sharedUI.jsx';
import { SyncedLyrics, PlainLyrics } from './Lyrics.jsx';

function CoverFullscreenOverlay({
  coverUrl, title, artist, album, accent,
  isPlaying = false, currentTime = 0, duration = 0,
  shuffleOn = false, repeat = 'off',
  volume = 1, onSetVolume,
  nowPlayingSliderStyle = 'circle',
  onTogglePlay, onPrev, onNext, onSeek, onToggleShuffle, onToggleRepeat,
  lyricsData = null, hasSyncedLyrics = false, hasPlainLyrics = false,
  onClose,
}) {
  const dialogRef = useRef(null);

  // Honour the OS "reduce motion" setting — skip the entrance/scale animations.
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Idle auto-hide: after a few seconds with no mouse/key activity, fade out
  // the controls + cursor so the cover sits as clean ambient art. Any movement
  // or keypress brings them back.
  const [idle, setIdle] = useState(false);
  const idleTimerRef = useRef(null);
  const bumpActivity = useCallback(() => {
    setIdle((cur) => (cur ? false : cur));
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => setIdle(true), 3000);
  }, []);

  // On open: save the element that had focus (the cover button), move focus
  // into the dialog, and start the idle timer. On close: restore focus.
  useEffect(() => {
    const prev = typeof document !== 'undefined' ? document.activeElement : null;
    dialogRef.current?.focus();
    bumpActivity();
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      try { if (prev && typeof prev.focus === 'function') prev.focus(); } catch { /* ignore */ }
    };
  }, [bumpActivity]);

  // Controls fade together when idle.
  // When idle the controls don't just fade — they collapse to zero height, so
  // the rail (which is vertically centered) smoothly re-centers the cover +
  // title. The max-height transition animates that motion. maxHeight when open
  // is comfortably above the real content height so nothing clips.
  const controlsFade = {
    width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center',
    overflow: 'hidden',
    opacity: idle ? 0 : 1,
    maxHeight: idle ? 0 : 240,
    pointerEvents: idle ? 'none' : 'auto',
    transition: 'opacity 0.4s ease, max-height 0.5s cubic-bezier(0.4,0,0.2,1)',
  };

  // Keyboard control while the overlay has focus. We only act when focus is on
  // the backdrop itself — once the user tabs to a button or slider, that
  // control handles its own keys (so Space/arrows aren't double-fired). Esc and
  // F are intentionally left to bubble to the global handler that opened us.
  const handleKey = (e) => {
    bumpActivity();
    // Trap Tab inside the overlay so focus can't wander to controls behind it.
    if (e.key === 'Tab') {
      const nodes = dialogRef.current
        ? dialogRef.current.querySelectorAll('button, [href], input, select, textarea, [role="slider"], [tabindex]:not([tabindex="-1"])')
        : [];
      const list = Array.prototype.filter.call(nodes, (el) => !el.disabled && el.offsetParent !== null);
      if (list.length === 0) { e.preventDefault(); dialogRef.current?.focus(); return; }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (active === dialogRef.current) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      return;
    }
    const t = e.target;
    const tag = (t.tagName || '').toLowerCase();
    const interactive = tag === 'button' || tag === 'input' || tag === 'textarea'
      || (t.getAttribute && t.getAttribute('role') === 'slider');
    if (interactive) return;
    const vol = typeof volume === 'number' ? volume : 1;
    switch (e.key) {
      case ' ': case 'k':
        e.preventDefault(); e.stopPropagation(); onTogglePlay?.(); break;
      case 'ArrowLeft':
        e.preventDefault(); e.stopPropagation(); onSeek?.(Math.max(0, currentTime - 5)); break;
      case 'ArrowRight':
        e.preventDefault(); e.stopPropagation(); onSeek?.(Math.min(duration || 0, currentTime + 5)); break;
      case 'ArrowUp':
        e.preventDefault(); e.stopPropagation(); onSetVolume?.(Math.min(1, vol + 0.05)); break;
      case 'ArrowDown':
        e.preventDefault(); e.stopPropagation(); onSetVolume?.(Math.max(0, vol - 0.05)); break;
      case 'm': case 'M':
        e.preventDefault(); e.stopPropagation(); onSetVolume?.(vol > 0 ? 0 : 1); break;
      default: break; // Esc / f bubble up to the parent
    }
  };

  const hasAnyLyrics = hasSyncedLyrics || hasPlainLyrics;

  // The cover/controls rail. Reused whether or not lyrics exist — when there
  // are no lyrics it simply centers in the screen on its own.
  const rail = (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 0, padding: '40px 36px',
      flexShrink: 0,
      width: hasAnyLyrics ? 'clamp(320px, 34vw, 460px)' : 'auto',
      ...(hasAnyLyrics ? {
        background: 'rgba(255,255,255,0.045)',
        borderRight: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(28px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(28px) saturate(1.3)',
        height: '100%',
      } : {}),
    }}>
      {/* Cover */}
      <div style={{
        position: 'relative',
        width: hasAnyLyrics ? 'min(26vw, 300px)' : 'min(58vh, 46vw)',
        aspectRatio: '1', borderRadius: 16, overflow: 'hidden',
        boxShadow: `0 24px 70px rgba(0,0,0,0.55), 0 0 0 1px rgba(${accent},0.4)`,
        background: '#111',
        animation: reduceMotion ? 'none' : 'immerseFullscreenCoverIn 300ms cubic-bezier(0.2,0.7,0.2,1)',
      }}>
        {coverUrl ? (
          <img src={coverUrl} alt={title ? `Cover for ${title}` : 'Cover art'}
            decoding="async" draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', imageRendering: 'high-quality' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444' }}>
            <Icons.AlbumSidebar />
          </div>
        )}
      </div>

      {/* Title / artist / album */}
      <div style={{ textAlign: 'center', marginTop: 22, maxWidth: '100%' }}>
        <div style={{
          fontSize: 'clamp(19px, 2.4vmin, 26px)', fontWeight: 700, color: '#fff',
          letterSpacing: '-0.01em', lineHeight: 1.15, textShadow: '0 2px 20px rgba(0,0,0,0.6)',
          overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>{(title || 'No track').trim()}</div>
        {artist ? (
          <div style={{
            marginTop: 5, fontSize: 'clamp(12px, 1.4vmin, 14px)', color: 'rgba(255,255,255,0.65)', fontWeight: 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {artist.trim()}{album ? <span style={{ color: 'rgba(255,255,255,0.4)' }}>{` · ${album.trim()}`}</span> : null}
          </div>
        ) : null}
      </div>

      {/* Controls (seek + transport + volume) — collapse + fade when idle so
          the cover re-centers smoothly */}
      <div style={controlsFade}>
      {/* Seek */}
      <div style={{ width: '100%', maxWidth: 380, marginTop: 20, display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, fontVariantNumeric: 'tabular-nums', minWidth: 32, textAlign: 'right' }}>{formatTime(currentTime)}</span>
        <HeartSlider value={currentTime} max={duration || 0} onChange={(v) => onSeek?.(v)} accent={accent} ariaLabel="Seek" thumbSize={12} thumbShape={nowPlayingSliderStyle} />
        <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, fontVariantNumeric: 'tabular-nums', minWidth: 32 }}>{formatTime(duration)}</span>
      </div>

      {/* Transport — same MediaSkipBtn/MediaPlayPauseBtn controls as the dock */}
      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'clamp(18px, 2.4vmin, 26px)' }}>
        <MediaToggleBtn onClick={onToggleShuffle} title="Shuffle" active={shuffleOn}>
          <Shuffle size={20} strokeWidth={2} />
        </MediaToggleBtn>
        <MediaSkipBtn onClick={onPrev} title="Previous">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 4L7 12l10 8" />
          </svg>
        </MediaSkipBtn>
        <MediaPlayPauseBtn onClick={onTogglePlay} isPlaying={isPlaying} />
        <MediaSkipBtn onClick={onNext} title="Next">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 4l10 8-10 8" />
          </svg>
        </MediaSkipBtn>
        <MediaToggleBtn onClick={onToggleRepeat} title={`Repeat: ${repeat}`} active={repeat !== 'off'}>
          {repeat === 'one' ? (
            <Repeat1 size={20} strokeWidth={2} />
          ) : (
            <Repeat size={20} strokeWidth={2} />
          )}
        </MediaToggleBtn>
      </div>

      {/* Volume — compact, centered */}
      {onSetVolume ? (
        <div style={{ width: '100%', maxWidth: 210, marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <button type="button" onClick={() => onSetVolume?.(volume > 0 ? 0 : 1)}
            title={volume > 0 ? 'Mute (M)' : 'Unmute (M)'}
            aria-label={volume > 0 ? 'Mute' : 'Unmute'}
            style={{
              flexShrink: 0, width: 30, height: 30, borderRadius: 8, border: 'none', padding: 0,
              background: 'transparent', color: 'rgba(255,255,255,0.6)', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}>
            {volume <= 0 ? (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 5L6 9H2v6h4l5 4V5z" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : volume < 0.5 ? (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            ) : (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            )}
          </button>
          <HeartSlider value={volume} max={1} onChange={(v) => onSetVolume?.(v)} accent={accent} ariaLabel="Volume" thumbSize={11} thumbShape={nowPlayingSliderStyle} />
        </div>
      ) : null}
      </div>
    </div>
  );

  return (
    <div
      ref={dialogRef} role="dialog" aria-modal="true"
      aria-label={`${title || 'Now playing'} — fullscreen`} tabIndex={-1}
      onClick={onClose} onKeyDown={handleKey} onMouseMove={bumpActivity}
      style={{
        position: 'fixed', inset: 0, zIndex: 120,
        // Sit ABOVE the app's window-drag title bar (z-index 99) and window
        // controls (z-index 101) — otherwise that drag region renders over the
        // top of the overlay and turns clicks on the close button into window
        // drags. The whole surface is no-drag; only the centre strip below
        // re-enables dragging the window.
        WebkitAppRegion: 'no-drag',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#000', animation: reduceMotion ? 'none' : 'immerseFullscreenIn 220ms ease-out', outline: 'none',
        cursor: idle ? 'none' : 'default',
      }}
    >
      <style>{`
        @keyframes immerseFullscreenIn { 0% { opacity: 0; } 100% { opacity: 1; } }
        @keyframes immerseFullscreenCoverIn { 0% { opacity: 0; transform: scale(0.96) translateY(8px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes immerseFullscreenLyricsIn { 0% { opacity: 0; } 100% { opacity: 1; } }
      `}</style>

      {/* Blurred cover backdrop */}
      {coverUrl ? (
        <div aria-hidden style={{
          position: 'absolute', inset: -80, backgroundImage: `url(${coverUrl})`,
          backgroundSize: 'cover', backgroundPosition: 'center',
          filter: 'blur(90px) saturate(1.5) brightness(0.5)', opacity: 0.85, pointerEvents: 'none',
        }} />
      ) : null}
      <div aria-hidden style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.6) 100%)', pointerEvents: 'none',
      }} />

      {/* Draggable strip — a fixed-width band in the CENTER of the top edge.
          Fixed insets (not %) guarantee the close button in the top-left
          corner is never inside the drag region, even on narrow windows where
          a percentage inset would creep over it and eat its clicks. */}
      <div aria-hidden onClick={(e) => e.stopPropagation()} style={{
        position: 'absolute', top: 0, left: 160, right: 160, height: 52, WebkitAppRegion: 'drag', zIndex: 4,
      }} />

      {/* Close — top-left, clear of OS window controls */}
      <button type="button" onClick={(e) => { e.stopPropagation(); onClose?.(); }}
        title="Close (Esc)" aria-label="Close fullscreen"
        style={{
          position: 'absolute', top: 16, left: 16, zIndex: 5, WebkitAppRegion: 'no-drag',
          display: 'inline-flex', alignItems: 'center', gap: 7, height: 36, padding: '0 14px 0 11px',
          borderRadius: 999, background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.14)',
          color: 'rgba(255,255,255,0.85)', cursor: 'pointer', fontSize: 12, fontWeight: 600,
          backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', transition: 'background 0.15s, color 0.15s, opacity 0.4s ease',
          opacity: idle ? 0 : 1, pointerEvents: idle ? 'none' : 'auto',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.78)'; e.currentTarget.style.color = '#fff'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.5)'; e.currentTarget.style.color = 'rgba(255,255,255,0.85)'; }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
        </svg>
        Close
      </button>

      {/* Content: rail + (optional) lyrics centerpiece */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative', zIndex: 2, cursor: 'default',
          display: 'flex', alignItems: 'stretch', justifyContent: 'center',
          width: hasAnyLyrics ? '100%' : 'auto', height: hasAnyLyrics ? '100%' : 'auto',
          maxWidth: '100vw',
        }}
      >
        {rail}
        {hasAnyLyrics ? (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center',
            padding: '6vmin clamp(28px, 5vw, 80px)', minWidth: 0,
            animation: reduceMotion ? 'none' : 'immerseFullscreenLyricsIn 360ms ease-out both', animationDelay: '80ms',
          }}>
            {hasSyncedLyrics ? (
              <SyncedLyrics
                lines={lyricsData.synced}
                currentTime={currentTime}
                accent={accent}
                onSeek={onSeek}
                fontSize={21}
                lineHeight={1.5}
              />
            ) : (
              <PlainLyrics text={lyricsData.plain} fontSize={22} lineHeight={1.7} accent={accent} />
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}


/* =========================================================================
 *  LyricShareOverlay — share a passage of lyrics as a beautifully
 *  composed card. Modelled on iOS / Apple Music's "Share Lyrics" sheet,
 *  re-skinned to match Immerse: blurred cover backdrop, accent-tinted
 *  glass, the cover thumb anchoring the composition, the selected lyric
 *  lines set in a generous editorial type, and a tasteful "immerse"
 *  wordmark in the corner.
 *
 *  Why a dedicated component:
 *    - The export pipeline (serialize to PNG / copy to clipboard / save
 *      to disk) is non-trivial and benefits from being all in one place.
 *    - The card itself is rendered as an SVG with `foreignObject` for
 *      the text. SVG is what we serialize to a PNG via canvas, so the
 *      visible preview and the exported image are by construction the
 *      same pixels.
 *    - Sits at z-index 50, the same layer as CoverFullscreenOverlay,
 *      so neither can be open over the other.
 *
 *  Esc closes. Click outside the card closes. Inside the card, clicks
 *  do nothing (won't accidentally dismiss while interacting with a
 *  button).
 * ========================================================================= */
function LyricShareOverlay({
  lines,
  track,
  coverUrl,
  accent,
  onClose,
}) {
  const dialogRef = useRef(null);
  const cardRef = useRef(null);
  useEffect(() => { dialogRef.current?.focus(); }, []);

  // Esc to close — own listener so we don't have to plumb through.
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose?.(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // Toast within the overlay — tiny self-contained confirmation, fades
  // out automatically. We don't reach into the app-wide toast bus from
  // here because the overlay is z:50 and would visually sit above any
  // global toasts anyway.
  const [innerToast, setInnerToast] = useState(null);
  const showInner = useCallback((msg) => {
    setInnerToast(msg);
    setTimeout(() => setInnerToast(null), 1800);
  }, []);

  const title = (track?.title || '').trim() || 'Unknown track';
  const artist = (track?.artist || '').trim() || 'Unknown artist';

  // Filter blank lines and keep just the visible ones.
  const trimmed = lines.filter((l) => l && l.trim().length > 0);
  const lineCount = trimmed.length;

  // --- Export helpers ---------------------------------------------------
  // The card is a 1080×1350 portrait (4:5 — IG portrait / Apple Music
  // share-card aspect). Rendering goes through the Canvas 2D API directly,
  // not through SVG `foreignObject`. Reasons:
  //   1. Cover art comes through Immerse's custom `studio-cover://` protocol.
  //      Loading it inside a Blob-URL SVG taints the canvas (silent failure
  //      mode: `canvas.toBlob()` returns null with no error).
  //   2. Browser SVG-to-canvas raster has a long history of fragile edge
  //      cases — `foreignObject` HTML doesn't always paint, embedded
  //      `<image>` doesn't always load, `<filter>` doesn't always render.
  //   3. Canvas 2D wrapping/text/clipping/gradients are all stable in
  //      Electron's Chromium and let us match Apple Music's widget look
  //      pixel-for-pixel.
  const SHARE_W = 1080;
  const SHARE_H = 1350;
  // Safe area for the lyric block — leaves room for the header (cover
  // thumb + title/artist) above and the IMMERSE footer below.
  const TEXT_PADDING_X = 100;          // horizontal inset for lyric column
  const TEXT_AREA_TOP = 360;           // below the header band
  const TEXT_AREA_BOTTOM = SHARE_H - 200; // above the footer band
  const TEXT_AREA_H = TEXT_AREA_BOTTOM - TEXT_AREA_TOP;
  const TEXT_AREA_W = SHARE_W - TEXT_PADDING_X * 2 - 32; // minus accent-bar gutter

  /**
   * Load the cover image into an HTMLImageElement that's drawable to a
   * canvas. Critical detail: we DO NOT use `fetch().then(blob).then(dataURL)`
   * because that path goes through different security plumbing than a
   * direct `<img>` load and can produce a canvas-tainting result for
   * `studio-cover://` URLs. A bare `<img src=...>` with `crossOrigin =
   * 'anonymous'` works because Electron registers `studio-cover` as a
   * standard protocol (see main.js `protocol.handle('studio-cover', ...)`)
   * and the in-renderer load is same-origin from the canvas's POV.
   *
   * Returns null if the cover fails to load, so the rest of the card can
   * still render with a placeholder.
   */
  const loadCoverImage = useCallback(() => {
    return new Promise((resolve) => {
      if (!coverUrl) { resolve(null); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => {
        // Retry without crossOrigin — some custom protocols (file://,
        // studio-cover://) reject the CORS preflight but still load when
        // accessed without it.
        const fallback = new Image();
        fallback.onload = () => resolve(fallback);
        fallback.onerror = (e) => {
          console.warn('cover load failed (both attempts):', e);
          resolve(null);
        };
        fallback.src = coverUrl;
      };
      img.src = coverUrl;
    });
  }, [coverUrl]);

  /**
   * Wrap text into lines that fit a max pixel width, given a measured
   * canvas context. Returns an array of strings (the wrapped lines).
   * Splits on whitespace; doesn't break inside words.
   */
  const wrapTextLine = (ctx, text, maxWidth) => {
    const words = String(text).split(/\s+/).filter(Boolean);
    if (!words.length) return [''];
    const out = [];
    let line = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const probe = `${line} ${words[i]}`;
      if (ctx.measureText(probe).width <= maxWidth) {
        line = probe;
      } else {
        out.push(line);
        line = words[i];
      }
    }
    out.push(line);
    return out;
  };

  /**
   * Pick the largest font size whose wrapped lyric block fits inside the
   * safe area. Measurement uses the same canvas context the rasterizer
   * will use, so the on-screen preview and the export agree.
   */
  const fitFontSize = (ctx) => {
    const candidates = [72, 64, 58, 52, 46, 40, 34, 30, 26, 22, 18];
    for (const size of candidates) {
      ctx.font = `700 ${size}px -apple-system, system-ui, "Segoe UI", Roboto, sans-serif`;
      const lineHeight = size * 1.28;
      const paragraphGap = size * 0.32;
      let totalH = 0;
      for (let i = 0; i < trimmed.length; i += 1) {
        const wrapped = wrapTextLine(ctx, trimmed[i], TEXT_AREA_W);
        totalH += wrapped.length * lineHeight;
        if (i < trimmed.length - 1) totalH += paragraphGap;
      }
      if (totalH <= TEXT_AREA_H) return size;
    }
    return candidates[candidates.length - 1];
  };

  /**
   * Render the share card directly to an offscreen canvas using Canvas
   * 2D primitives. Returns a PNG Blob ready for clipboard write or
   * download. Throws if the canvas operation itself fails.
   */
  const rasterize = useCallback(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = SHARE_W;
    canvas.height = SHARE_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');

    const cover = await loadCoverImage();

    // --- Backdrop --------------------------------------------------
    // The cover, scaled to fill, with a heavy blur on top via stacked
    // canvas filters. Canvas `filter` property supports CSS filters in
    // Chromium / Electron.
    if (cover) {
      ctx.save();
      ctx.filter = 'blur(60px) saturate(1.45) brightness(0.5)';
      // Cover-fit the image, bleeding past the canvas edges so the blur
      // doesn't show seams.
      const scale = Math.max(
        (SHARE_W + 200) / cover.naturalWidth,
        (SHARE_H + 200) / cover.naturalHeight,
      );
      const drawW = cover.naturalWidth * scale;
      const drawH = cover.naturalHeight * scale;
      ctx.drawImage(
        cover,
        (SHARE_W - drawW) / 2,
        (SHARE_H - drawH) / 2,
        drawW, drawH,
      );
      ctx.restore();
    } else {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, SHARE_W, SHARE_H);
    }

    // --- Vignette (top→bottom darkening) ---------------------------
    const vignette = ctx.createLinearGradient(0, 0, 0, SHARE_H);
    vignette.addColorStop(0, 'rgba(0,0,0,0.32)');
    vignette.addColorStop(0.5, 'rgba(0,0,0,0.5)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.78)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, SHARE_W, SHARE_H);

    // --- Accent glow from bottom-center ----------------------------
    const glow = ctx.createRadialGradient(
      SHARE_W / 2, SHARE_H, 0,
      SHARE_W / 2, SHARE_H, SHARE_H * 0.9,
    );
    glow.addColorStop(0, `rgba(${accent}, 0.45)`);
    glow.addColorStop(0.6, `rgba(${accent}, 0.1)`);
    glow.addColorStop(1, `rgba(${accent}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, SHARE_W, SHARE_H);

    // --- Cover thumb -----------------------------------------------
    const COVER_X = TEXT_PADDING_X;
    const COVER_Y = 130;
    const COVER_SIZE = 130;
    const COVER_RADIUS = 18;
    ctx.save();
    // Rounded-rect clip for the cover.
    const r = COVER_RADIUS;
    ctx.beginPath();
    ctx.moveTo(COVER_X + r, COVER_Y);
    ctx.lineTo(COVER_X + COVER_SIZE - r, COVER_Y);
    ctx.quadraticCurveTo(COVER_X + COVER_SIZE, COVER_Y, COVER_X + COVER_SIZE, COVER_Y + r);
    ctx.lineTo(COVER_X + COVER_SIZE, COVER_Y + COVER_SIZE - r);
    ctx.quadraticCurveTo(COVER_X + COVER_SIZE, COVER_Y + COVER_SIZE, COVER_X + COVER_SIZE - r, COVER_Y + COVER_SIZE);
    ctx.lineTo(COVER_X + r, COVER_Y + COVER_SIZE);
    ctx.quadraticCurveTo(COVER_X, COVER_Y + COVER_SIZE, COVER_X, COVER_Y + COVER_SIZE - r);
    ctx.lineTo(COVER_X, COVER_Y + r);
    ctx.quadraticCurveTo(COVER_X, COVER_Y, COVER_X + r, COVER_Y);
    ctx.closePath();
    ctx.clip();
    if (cover) {
      // Cover-fit the source image into the thumb rect.
      const sScale = Math.max(
        COVER_SIZE / cover.naturalWidth,
        COVER_SIZE / cover.naturalHeight,
      );
      const sW = cover.naturalWidth * sScale;
      const sH = cover.naturalHeight * sScale;
      ctx.drawImage(
        cover,
        COVER_X + (COVER_SIZE - sW) / 2,
        COVER_Y + (COVER_SIZE - sH) / 2,
        sW, sH,
      );
    } else {
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(COVER_X, COVER_Y, COVER_SIZE, COVER_SIZE);
    }
    ctx.restore();

    // --- Title + artist -------------------------------------------
    const META_X = COVER_X + COVER_SIZE + 24;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 34px -apple-system, system-ui, "Segoe UI", Roboto, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 1;
    // Truncate title/artist to fit one line each.
    const maxMetaW = SHARE_W - META_X - TEXT_PADDING_X;
    const fitOneLine = (text, fontSpec) => {
      ctx.font = fontSpec;
      if (ctx.measureText(text).width <= maxMetaW) return text;
      let s = text;
      while (s.length > 1 && ctx.measureText(`${s}…`).width > maxMetaW) {
        s = s.slice(0, -1);
      }
      return `${s}…`;
    };
    ctx.font = '700 34px -apple-system, system-ui, "Segoe UI", Roboto, sans-serif';
    const fittedTitle = fitOneLine(title, ctx.font);
    ctx.fillText(fittedTitle, META_X, COVER_Y + 52);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = '500 26px -apple-system, system-ui, "Segoe UI", Roboto, sans-serif';
    const fittedArtist = fitOneLine(artist, ctx.font);
    ctx.fillText(fittedArtist, META_X, COVER_Y + 92);
    // Reset shadow before drawing further elements that don't want it.
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // --- Accent bar -----------------------------------------------
    const BAR_X = TEXT_PADDING_X;
    const BAR_Y = TEXT_AREA_TOP + 6;
    const BAR_H = TEXT_AREA_H - 12;
    const BAR_W = 6;
    ctx.fillStyle = `rgb(${accent})`;
    // Rounded pill
    ctx.beginPath();
    const rb = BAR_W / 2;
    ctx.moveTo(BAR_X + rb, BAR_Y);
    ctx.lineTo(BAR_X + BAR_W - rb, BAR_Y);
    ctx.quadraticCurveTo(BAR_X + BAR_W, BAR_Y, BAR_X + BAR_W, BAR_Y + rb);
    ctx.lineTo(BAR_X + BAR_W, BAR_Y + BAR_H - rb);
    ctx.quadraticCurveTo(BAR_X + BAR_W, BAR_Y + BAR_H, BAR_X + BAR_W - rb, BAR_Y + BAR_H);
    ctx.lineTo(BAR_X + rb, BAR_Y + BAR_H);
    ctx.quadraticCurveTo(BAR_X, BAR_Y + BAR_H, BAR_X, BAR_Y + BAR_H - rb);
    ctx.lineTo(BAR_X, BAR_Y + rb);
    ctx.quadraticCurveTo(BAR_X, BAR_Y, BAR_X + rb, BAR_Y);
    ctx.closePath();
    ctx.fill();

    // --- Lyric text -----------------------------------------------
    // Pick the largest font that fits, then render the wrapped lines
    // centered vertically inside the safe area.
    const bodyFontPx = fitFontSize(ctx);
    ctx.font = `700 ${bodyFontPx}px -apple-system, system-ui, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 2;

    const lineHeight = bodyFontPx * 1.28;
    const paragraphGap = bodyFontPx * 0.32;
    // Pre-wrap so we can vertically center.
    const wrappedParagraphs = trimmed.map((line) => wrapTextLine(ctx, line, TEXT_AREA_W));
    let totalH = 0;
    wrappedParagraphs.forEach((lines2, i) => {
      totalH += lines2.length * lineHeight;
      if (i < wrappedParagraphs.length - 1) totalH += paragraphGap;
    });
    const blockTop = TEXT_AREA_TOP + (TEXT_AREA_H - totalH) / 2;
    const textX = BAR_X + BAR_W + 26;
    let cursorY = blockTop + lineHeight * 0.8; // alphabetic baseline offset
    wrappedParagraphs.forEach((lines2, pIdx) => {
      lines2.forEach((ln) => {
        ctx.fillText(ln, textX, cursorY);
        cursorY += lineHeight;
      });
      if (pIdx < wrappedParagraphs.length - 1) cursorY += paragraphGap;
    });
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // --- Footer: IMMERSE wordmark + accent orb ---------------------
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '600 22px -apple-system, system-ui, "Segoe UI", Roboto, sans-serif';
    // Letter-spaced uppercase wordmark. Canvas 2D has no letter-spacing,
    // so we draw glyph-by-glyph with a manual tracking offset.
    const wordmark = 'IMMERSE';
    const trackPx = 13; // approximates 0.6em letter-spacing at this size
    let wx = TEXT_PADDING_X;
    const wy = SHARE_H - 90;
    for (const ch of wordmark) {
      ctx.fillText(ch, wx, wy);
      wx += ctx.measureText(ch).width + trackPx;
    }
    // Accent orb — three concentric circles, smallest filled, two outer
    // rings stroked at reducing opacities for the radar / sound-wave feel.
    const orbX = SHARE_W - 115;
    const orbY = SHARE_H - 100;
    ctx.beginPath();
    ctx.arc(orbX, orbY, 30, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${accent}, 0.18)`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(orbX, orbY, 22, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${accent}, 0.35)`;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(orbX, orbY, 14, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${accent}, 0.85)`;
    ctx.fill();

    // --- Export ----------------------------------------------------
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('canvas.toBlob returned null (canvas may be tainted)'));
      }, 'image/png', 0.95);
    });
  }, [accent, title, artist, trimmed, loadCoverImage, fitFontSize, wrapTextLine,
      SHARE_W, SHARE_H, TEXT_AREA_TOP, TEXT_AREA_H, TEXT_AREA_W, TEXT_PADDING_X]);

  const handleShareWithFriends = useCallback(async () => {
    try {
      const blob = await rasterize();
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
        throw new Error('ClipboardItem not supported');
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      showInner('Image copied — paste in any chat');
    } catch (err) {
      console.error('share with friends failed:', err);
      const msg = /denied|permission|notallowed/i.test(String(err?.message || err))
        ? 'Clipboard blocked'
        : 'Copy failed';
      showInner(msg);
    }
  }, [rasterize, showInner]);

  // --- Render ----------------------------------------------------------
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Share lyric"
      tabIndex={-1}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 'clamp(12px, 3vmin, 28px)',
        background: '#000',
        cursor: 'zoom-out',
        animation: 'immerseFullscreenIn 220ms ease-out',
        outline: 'none',
        overflow: 'auto',
      }}
    >
      <style>{`
        @keyframes immerseShareCardIn {
          0%   { opacity: 0; transform: scale(0.96) translateY(8px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes immerseShareToastIn {
          0%   { opacity: 0; transform: translate(-50%, 12px); }
          100% { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>

      {/* Blurred cover backdrop — identical technique to CoverFullscreenOverlay. */}
      {coverUrl ? (
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: -80,
            backgroundImage: `url(${coverUrl})`,
            backgroundSize: 'cover', backgroundPosition: 'center',
            filter: 'blur(80px) saturate(1.45) brightness(0.5)',
            opacity: 0.85,
            pointerEvents: 'none',
          }}
        />
      ) : null}
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 100%),
                       radial-gradient(ellipse at 50% 90%, rgba(${accent},0.25) 0%, rgba(${accent},0) 60%)`,
          pointerEvents: 'none',
        }}
      />

      {/* Close — top-left so it does not overlap the window close button (top-right). */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose?.(); }}
        title="Close (Esc)"
        aria-label="Close"
        style={{
          position: 'absolute', top: 16, left: 16, zIndex: 2,
          WebkitAppRegion: 'no-drag',
          width: 36, height: 36, borderRadius: 999,
          background: 'rgba(0,0,0,0.55)',
          border: '1px solid rgba(255,255,255,0.14)',
          color: 'rgba(255,255,255,0.85)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
          backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.8)'; e.currentTarget.style.color = '#fff'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.55)'; e.currentTarget.style.color = 'rgba(255,255,255,0.85)'; }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <div
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative', zIndex: 1,
          width: 'min(440px, calc((100vh - 200px) * 0.8))',
          aspectRatio: '4 / 5',
          borderRadius: 22, overflow: 'hidden',
          boxShadow: `0 32px 120px rgba(0,0,0,0.65), 0 0 0 1px rgba(${accent},0.4), 0 0 60px rgba(${accent},0.12)`,
          background: '#111',
          animation: 'immerseShareCardIn 320ms cubic-bezier(0.2, 0.7, 0.2, 1)',
          cursor: 'default',
          containerType: 'inline-size',
        }}
      >
        {/* Backdrop layer of the card itself — same cover, blurred. */}
        {coverUrl ? (
          <div
            aria-hidden
            style={{
              position: 'absolute', inset: -40,
              backgroundImage: `url(${coverUrl})`,
              backgroundSize: 'cover', backgroundPosition: 'center',
              filter: 'blur(60px) saturate(1.4) brightness(0.55)',
            }}
          />
        ) : (
          <div aria-hidden style={{ position: 'absolute', inset: 0, background: '#0a0a0a' }} />
        )}
        {/* Vignette + accent glow */}
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: 0,
            background: `linear-gradient(180deg, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0.5) 60%, rgba(0,0,0,0.78) 100%),
                         radial-gradient(ellipse at 50% 95%, rgba(${accent},0.45) 0%, rgba(${accent},0) 65%)`,
          }}
        />

        <div style={{
          position: 'absolute',
          top: '9.6%', left: '9.2%', right: '9.2%',
          display: 'flex', alignItems: 'center', gap: '4%',
        }}>
          <div style={{
            width: '26%', aspectRatio: '1',
            borderRadius: 12, overflow: 'hidden',
            background: '#1a1a1a', flexShrink: 0,
            boxShadow: '0 2px 14px rgba(0,0,0,0.55)',
          }}>
            {coverUrl ? (
              <img src={coverUrl} alt="" draggable={false}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            ) : (
              <div style={{
                width: '100%', height: '100%', display: 'flex',
                alignItems: 'center', justifyContent: 'center', color: '#444',
              }}>
                <Icons.AlbumSidebar />
              </div>
            )}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: 'clamp(15px, 3.3cqi, 20px)', fontWeight: 700, color: '#fff',
              letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              textShadow: '0 1px 8px rgba(0,0,0,0.6)',
            }}>
              {title}
            </div>
            <div style={{
              marginTop: 3,
              fontSize: 'clamp(12px, 2.6cqi, 15px)', color: 'rgba(255,255,255,0.72)', fontWeight: 500,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              textShadow: '0 1px 8px rgba(0,0,0,0.6)',
            }}>
              {artist}
            </div>
          </div>
        </div>

        <div style={{
          position: 'absolute',
          top: '27%', bottom: '15%',
          left: '9.2%', right: '9.2%',
          display: 'flex',
          gap: '4%',
        }}>
          <div style={{
            width: 5, borderRadius: 999,
            background: `rgb(${accent})`,
            boxShadow: `0 0 16px rgba(${accent},0.7)`,
            flexShrink: 0,
          }} />
          <div style={{
            flex: 1, minWidth: 0,
            display: 'flex', flexDirection: 'column', justifyContent: 'center',
            fontSize: (() => {
              if (lineCount <= 1) return 'clamp(28px, 8.2cqi, 56px)';
              if (lineCount <= 2) return 'clamp(24px, 7.2cqi, 48px)';
              if (lineCount <= 4) return 'clamp(20px, 6cqi, 40px)';
              if (lineCount <= 6) return 'clamp(17px, 5cqi, 32px)';
              if (lineCount <= 8) return 'clamp(15px, 4.2cqi, 28px)';
              return 'clamp(13px, 3.5cqi, 22px)';
            })(),
            fontWeight: 700, lineHeight: 1.28, color: '#fff',
            letterSpacing: '-0.015em',
            textShadow: '0 2px 18px rgba(0,0,0,0.5)',
            wordBreak: 'normal',
            overflowWrap: 'break-word',
          }}>
            {trimmed.map((line, i) => (
              <div key={i} style={{ marginBottom: i < trimmed.length - 1 ? '0.32em' : 0 }}>
                {line}
              </div>
            ))}
          </div>
        </div>

        <div style={{
          position: 'absolute', left: '9.2%', right: '9.2%',
          bottom: '7%',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{
            fontSize: 'clamp(10px, 2.2cqi, 14px)', fontWeight: 600,
            color: 'rgba(255,255,255,0.6)',
            letterSpacing: '0.55em', textTransform: 'uppercase',
          }}>
            IMMERSE
          </div>
          <div style={{ position: 'relative', width: 'clamp(28px, 7cqi, 38px)', aspectRatio: '1', flexShrink: 0 }}>
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              border: `2px solid rgba(${accent},0.18)`,
            }} />
            <div style={{
              position: 'absolute', inset: 4, borderRadius: '50%',
              border: `2px solid rgba(${accent},0.35)`,
            }} />
            <div style={{
              position: 'absolute', inset: 9, borderRadius: '50%',
              background: `rgba(${accent},0.85)`,
              boxShadow: `0 0 12px rgba(${accent},0.6)`,
            }} />
          </div>
        </div>
      </div>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative', zIndex: 1,
          marginTop: 'clamp(16px, 3vmin, 24px)',
          cursor: 'default',
        }}
      >
        <ShareActionButton
          accent={accent}
          primary
          onClick={handleShareWithFriends}
          label="Share with friends"
          icon={(
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          )}
        />
      </div>

      {/* Inner toast — confirms a copy/save action. */}
      {innerToast ? (
        <div
          style={{
            position: 'fixed',
            left: '50%', bottom: 'clamp(40px, 8vmin, 80px)',
            transform: 'translateX(-50%)',
            padding: '10px 18px', borderRadius: 999,
            background: 'rgba(20,20,22,0.92)',
            border: `1px solid rgba(${accent},0.4)`,
            backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
            color: '#fff', fontSize: 12, fontWeight: 600,
            boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
            zIndex: 3, pointerEvents: 'none',
            animation: 'immerseShareToastIn 220ms ease-out',
          }}
        >
          {innerToast}
        </div>
      ) : null}
    </div>
  );
}

/** ShareActionButton — small glass pill used in the LyricShareOverlay
 *  action bar. Two variants: standard (subtle glass) and primary (accent
 *  fill, used for the headline action). Hovers brighten predictably. */
function ShareActionButton({ icon, label, onClick, accent, primary = false }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 16px', borderRadius: 999,
        border: primary
          ? `1px solid rgba(${accent},${hover ? 0.7 : 0.55})`
          : `1px solid rgba(255,255,255,${hover ? 0.18 : 0.1})`,
        background: primary
          ? `rgba(${accent},${hover ? 0.42 : 0.32})`
          : `rgba(20,20,22,${hover ? 0.85 : 0.7})`,
        backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        color: '#fff', fontSize: 12, fontWeight: 700, letterSpacing: '0.01em',
        cursor: 'pointer',
        boxShadow: primary
          ? `0 6px 22px rgba(${accent},0.35)`
          : '0 4px 14px rgba(0,0,0,0.35)',
        transition: 'background 0.15s, border-color 0.15s, transform 0.1s',
        transform: hover ? 'translateY(-1px)' : 'translateY(0)',
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}


/* =========================================================================
 *  EdgeBleedBand — thin gradient strip at the bottom of the immersive
 *  stage, tinted with the playing track's accent colour. Like the cover
 *  is "leaking light" into the bottom of the room.
 *
 *  Fixed-position so it sits above the gradient field but below the dock
 *  pill and side panel. Pointer-events disabled so it never intercepts
 *  clicks meant for things below it (which there aren't any of, but
 *  defensive). Accent updates pick up automatically via the inline style
 *  — no animation hooks needed.
 *
 *  60px tall: enough to read as ambient light, not enough to dominate
 *  the cover composition. Gradient fades from accent at the bottom edge
 *  to transparent at the top via a bottom-aligned ellipse, so the band
 *  feels diffuse rather than a sharp line.
 * ========================================================================= */

/* =========================================================================
 *  BoostButton — sits at the right end of the volume slider in the dock.
 *
 *  The audio element's own .volume property is capped at 1.0 by the HTML
 *  spec, so for tracks mastered too quietly (or just to crank), we route
 *  playback through a Web Audio GainNode that can multiply the signal up
 *  to 4×. This control is the user's handle on that gain.
 *
 *  Behaviour:
 *   - Default state (boost === 1): looks like a regular speaker-with-
 *     waves icon, matching what was there before this feature existed.
 *   - Boosted state (boost > 1): the speaker is replaced with the live
 *     multiplier ("1.5×", "2.4×", "4×") in accent colour with a soft
 *     glow, so the user can see at a glance that boost is active.
 *   - Click opens a popover with a slider (1× to 4×) plus a Reset pill
 *     for jumping straight back to 1×. Closes on outside click / Esc.
 *
 *  The boost feeds into App.jsx's gainNodeRef via the onSetBoost prop;
 *  see App.jsx for the audio graph wiring and the compressor safety net.
 * ========================================================================= */
function BoostButton({ boost = 1, onSetBoost, accent }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);

  // Close on outside click / Esc. Mirror the pattern used by other
  // popovers in this file (RecentPeekPopover, etc.) for consistency.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (popoverRef.current?.contains(e.target)) return;
      if (buttonRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = boost > 1.005;
  // Format like "1.5×" or "2×" — drop the decimal if it's a clean integer.
  const label = (() => {
    const r = Math.round(boost * 10) / 10;
    if (Math.abs(r - Math.round(r)) < 0.05) return `${Math.round(r)}×`;
    return `${r.toFixed(1)}×`;
  })();

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={active ? `Volume boost: ${label}` : 'Volume boost'}
        aria-label="Volume boost"
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{
          // Wider than the original 24-square so the multiplier label
          // has breathing room (up to "14.5×" / "16×" at high boost);
          // still compact enough to live in the dock row.
          minWidth: active ? 40 : 24, height: 24,
          padding: active ? '0 6px' : 0,
          border: active ? `1px solid rgba(${accent},0.5)` : 'none',
          background: active ? `rgba(${accent},0.18)` : 'transparent',
          borderRadius: 999,
          color: active ? `rgb(${accent})` : 'rgba(255,255,255,0.7)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, letterSpacing: '-0.01em',
          // The accent glow when active is what makes boost feel "ON" at
          // a glance, like a hardware indicator light.
          boxShadow: active ? `0 0 12px rgba(${accent},0.35)` : 'none',
          transition: 'background 0.15s, color 0.15s, box-shadow 0.15s, border-color 0.15s, min-width 0.15s',
        }}
        onMouseEnter={(e) => {
          if (active) return;
          e.currentTarget.style.color = '#fff';
        }}
        onMouseLeave={(e) => {
          if (active) return;
          e.currentTarget.style.color = 'rgba(255,255,255,0.7)';
        }}
      >
        {active ? label : (
          // speaker-with-waves — identical to the icon that lived
          // here before, so users who never touch boost see exactly the
          // same dock.
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M10 5 L 6 9 L 3 9 C 2.4 9, 2 9.4, 2 10 L 2 14 C 2 14.6, 2.4 15, 3 15 L 6 15 L 10 19 C 10.5 19.4, 11 19.1, 11 18.5 L 11 5.5 C 11 4.9, 10.5 4.6, 10 5 Z" />
            <path d="M14.5 9 C 16 10.3, 16 13.7, 14.5 15" />
            <path d="M17.5 6.5 C 20.5 9, 20.5 15, 17.5 17.5" />
          </svg>
        )}
      </button>

      {open ? (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Volume boost"
          style={{
            position: 'absolute',
            // Anchor to the right edge of the button, opening upward so
            // the popover doesn't shoot off the bottom of the dock.
            right: 0, bottom: 'calc(100% + 8px)',
            width: 220,
            padding: '14px 14px 12px',
            background: 'rgba(20,20,22,0.94)',
            border: `1px solid rgba(${accent},0.3)`,
            borderRadius: 12,
            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            boxShadow: `0 14px 40px rgba(0,0,0,0.6), 0 0 24px rgba(${accent},0.12)`,
            zIndex: 60,
            animation: 'immerseBoostPopIn 160ms ease-out',
          }}
        >
          <style>{`
            @keyframes immerseBoostPopIn {
              0%   { opacity: 0; transform: translateY(4px) scale(0.97); }
              100% { opacity: 1; transform: translateY(0)    scale(1);    }
            }
          `}</style>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 10,
          }}>
            <div style={{
              fontSize: 10.5, fontWeight: 700, color: 'rgba(255,255,255,0.55)',
              letterSpacing: '0.14em', textTransform: 'uppercase',
            }}>
              Volume boost
            </div>
            <div style={{
              fontSize: 13, fontWeight: 700,
              color: active ? `rgb(${accent})` : 'rgba(255,255,255,0.7)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {label}
            </div>
          </div>

          {/* The slider. With max bumped to 16×, a linear range would
              cram 1-4× (where users will live 90% of the time) into the
              first quarter of the track. Instead the slider's raw value
              is the LOG of the boost (base 2): 0→4 maps to 1×→16×, with
              each integer step doubling. This gives equal space to each
              "doubling level" — perceptually how loudness actually feels.
              0.05 step = ~3.5% multiplier resolution, fine-grained enough
              for nudges but not so fine that the thumb feels twitchy. */}
          <input
            type="range"
            min="0"
            max="4"
            step="0.05"
            value={Math.log2(boost)}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              onSetBoost?.(Math.pow(2, v));
            }}
            aria-label="Volume boost multiplier"
            style={{
              width: '100%', height: 4,
              WebkitAppearance: 'none', appearance: 'none',
              background: `linear-gradient(to right,
                rgba(${accent},0.85) 0%,
                rgba(${accent},0.85) ${(Math.log2(boost) / 4) * 100}%,
                rgba(255,255,255,0.1)  ${(Math.log2(boost) / 4) * 100}%,
                rgba(255,255,255,0.1)  100%)`,
              borderRadius: 999,
              outline: 'none',
              cursor: 'pointer',
            }}
          />
          {/* Custom thumb styling — kept inline in <style> so we don't
              need to touch any global CSS. The selectors target only the
              slider inside this popover via the parent attribute. */}
          <style>{`
            [aria-label="Volume boost"] input[type="range"]::-webkit-slider-thumb {
              -webkit-appearance: none;
              appearance: none;
              width: 14px; height: 14px;
              border-radius: 50%;
              background: rgb(${accent});
              border: 2px solid #fff;
              cursor: pointer;
              box-shadow: 0 0 10px rgba(${accent},0.55);
            }
            [aria-label="Volume boost"] input[type="range"]::-moz-range-thumb {
              width: 14px; height: 14px;
              border-radius: 50%;
              background: rgb(${accent});
              border: 2px solid #fff;
              cursor: pointer;
              box-shadow: 0 0 10px rgba(${accent},0.55);
            }
          `}</style>

          {/* Tick row — quick-jump pills at each doubling level. Saves
              the user from carefully aiming the thumb when they just
              want "8×". Position uses log spacing to match the slider's
              own log mapping — visually each pill is roughly under its
              equivalent point on the track. */}
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            marginTop: 6, marginBottom: 10,
            fontSize: 9.5, fontWeight: 600, color: 'rgba(255,255,255,0.45)',
          }}>
            {[1, 2, 4, 8, 16].map((tick) => {
              const isActive = Math.abs(boost - tick) < 0.06 * tick; // proportional tolerance
              return (
                <button
                  key={tick}
                  type="button"
                  onClick={() => onSetBoost?.(tick)}
                  style={{
                    border: 'none', background: 'transparent', padding: '2px 4px',
                    color: isActive ? `rgb(${accent})` : 'inherit',
                    fontWeight: isActive ? 700 : 600,
                    fontSize: 'inherit', cursor: 'pointer',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = isActive
                      ? `rgb(${accent})` : 'rgba(255,255,255,0.45)';
                  }}
                >
                  {tick}×
                </button>
              );
            })}
          </div>

          {/* High-boost warning. Past 8× the limiter is doing real work
              and the audio character is genuinely affected — better that
              the user knows than to think "why does this sound crunchy".
              The warning fades in at 8× and saturates at 16×. */}
          {boost > 8 ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 10px', marginBottom: 10,
              borderRadius: 8,
              background: 'rgba(255, 170, 70, 0.1)',
              border: '1px solid rgba(255, 170, 70, 0.3)',
              fontSize: 10.5, color: 'rgba(255, 200, 130, 0.95)',
              lineHeight: 1.35,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden>
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>Extreme boost — protect your ears and speakers.</span>
            </div>
          ) : null}

          <div style={{
            display: 'flex', gap: 8, alignItems: 'center',
            paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)',
          }}>
            <div style={{
              flex: 1, fontSize: 10, color: 'rgba(255,255,255,0.45)', lineHeight: 1.3,
            }}>
              Amplifies past 100%. A soft limiter prevents clipping at high boost.
            </div>
            <button
              type="button"
              onClick={() => onSetBoost?.(1)}
              disabled={!active}
              style={{
                padding: '5px 10px', borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.04)',
                color: active ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.3)',
                fontSize: 10.5, fontWeight: 600,
                cursor: active ? 'pointer' : 'not-allowed',
                transition: 'background 0.12s, color 0.12s',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => {
                if (!active) return;
                e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                if (!active) return;
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                e.currentTarget.style.color = 'rgba(255,255,255,0.85)';
              }}
            >
              Reset
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export { CoverFullscreenOverlay, LyricShareOverlay, ShareActionButton, BoostButton };
