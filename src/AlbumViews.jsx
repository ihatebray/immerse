import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import Icons from './Icons.jsx';
import { formatTime } from './mediaUtils.js';
import { ExplicitBadge } from './sharedUI.jsx';

function AlbumCover({ album, showDiscBadge = true }) {
  const hasMulti = album.hasMultipleDiscs && album.discCoverArts?.length >= 2;

  if (!hasMulti) {
    if (!album.coverArt) {
      return (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2a2a2a' }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>
        </div>
      );
    }
    return <img src={album.coverArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} decoding="async" />;
  }

  const [coverA, coverB] = album.discCoverArts;
  // Unique clip id so multiple SplitDiscCover instances don't collide
  const clipId = `disc-split-${album.key.replace(/[^a-zA-Z0-9]/g, '_')}`;

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"
      style={{ width: '100%', height: '100%', display: 'block' }}>
      <defs>
        {/* Top-left triangle (disc 1) */}
        <clipPath id={`${clipId}-a`}>
          <polygon points="0,0 100,0 0,100" />
        </clipPath>
        {/* Bottom-right triangle (disc 2) */}
        <clipPath id={`${clipId}-b`}>
          <polygon points="100,0 100,100 0,100" />
        </clipPath>
      </defs>

      {/* Neutral background in case images are slow to load */}
      <rect x="0" y="0" width="100" height="100" fill="#111" />

      {/* Disc 1 — top-left triangle */}
      <image href={coverA} x="0" y="0" width="100" height="100"
        preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clipId}-a)`} />

      {/* Disc 2 — bottom-right triangle */}
      <image href={coverB} x="0" y="0" width="100" height="100"
        preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clipId}-b)`} />

      {/* Thin diagonal divider */}
      <line x1="100" y1="0" x2="0" y2="100"
        stroke="rgba(255,255,255,0.9)" strokeWidth="0.7" />
    </svg>
  );
}


function AlbumGridView({ albums, currentTrack, onOpenAlbum, onPlayAlbum, accent }) {
  const [hovAlbum, setHovAlbum] = useState(null);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '2px 4px 8px' }}>
      {albums.map((album) => {
        const isHov = hovAlbum === album.key;
        const isActive = album.tracks.some((t) => t.id === currentTrack?.id);
        return (
          <div key={album.key}
            onMouseEnter={() => setHovAlbum(album.key)}
            onMouseLeave={() => setHovAlbum(null)}
            onClick={() => onOpenAlbum(album.key)}
            style={{
              borderRadius: 10, overflow: 'hidden', cursor: 'pointer',
              background: isHov ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
              // The "border" is rendered as an inset box-shadow so it doesn't
              // occupy layout space. A real 1px border would change the box's
              // outer size when its color changes, causing a tiny but visible
              // pulse on hover and on active-state toggle. box-shadow is paint-
              // only — zero layout impact, zero pulse.
              boxShadow: `inset 0 0 0 1px ${isActive ? `rgba(${accent},0.35)` : 'rgba(255,255,255,0.06)'}`,
              // Only transition the properties we actually change here:
              // background and box-shadow. Avoiding `transition: all` keeps
              // any layout-influencing property (border, margin, padding,
              // size) from getting unintended animations.
              transition: 'background 0.15s, box-shadow 0.15s',
              position: 'relative',
            }}>
            {/* Cover art */}
            <div style={{ width: '100%', aspectRatio: '1', background: '#111', position: 'relative' }}>
              <AlbumCover album={album} />
              {/* Play overlay on hover */}
              {isHov ? (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <button type="button"
                    onClick={(e) => { e.stopPropagation(); onPlayAlbum(album); }}
                    title="Play album"
                    style={{ width: 38, height: 38, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.9)', color: '#000', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  </button>
                </div>
              ) : null}
              {/* Now playing dot */}
              {isActive ? (
                <div style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: '50%', background: `rgb(${accent})`, boxShadow: `0 0 6px rgba(${accent},0.8)` }} />
              ) : null}
            </div>
            {/* Info */}
            <div style={{ padding: '8px 8px 9px' }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: isActive ? '#fff' : 'rgba(255,255,255,0.9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                {album.album}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {album.artist}
              </div>
              <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>
                {album.tracks.length} {album.tracks.length === 1 ? 'track' : 'tracks'}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * AlbumStackView — Cover Flow–style horizontal album browser.
 *
 * Drop-in alternative to AlbumGridView. Albums fan out around a focused
 * center card; flanking cards scale + rotate away in 3D, fading toward
 * the edges. Click a side card to focus it; click the center card to
 * open the album (matches grid behavior). Scroll-wheel or trackpad
 * horizontal scroll flips through the stack.
 *
 * Why this exists alongside the grid:
 *   - Grid is good for scanning by name.
 *   - Stack is good for flipping by feel — your eye catches a cover
 *     you'd forgotten and you stop. Matches the way people flipped
 *     through a CD wallet or record bin.
 *
 * Performance notes:
 *   - Only cards within ±STACK_RENDER_RADIUS of the focused index are
 *     rendered. A 500-album library renders ~9 DOM nodes at a time
 *     instead of 500.
 *   - All movement is GPU transforms (translate3d / rotateY / scale),
 *     not layout properties — keeps animation off the main thread.
 */

// How many cards on each side of the focused card stay rendered. 4 looks
// best — enough to give depth but not so many that distant cards become
// muddy. Cards beyond this fade to opacity 0 anyway.
const STACK_RENDER_RADIUS = 4;

// Card size is computed dynamically from the container width to handle
// the resizable dock panel (default 340px but user-adjustable). The
// proportions stay constant: the focused card takes ~75% of the
// container width, the gap between adjacent cards' centers is ~38%.
// Hard floor of 140px keeps it usable on the narrowest panels.
function computeStackMetrics(containerWidth) {
  const cardSize = Math.max(140, Math.min(320, Math.round(containerWidth * 0.75)));
  const cardGap = Math.round(cardSize * 0.5);
  return { cardSize, cardGap };
}

function AlbumStackView({ albums, currentTrack, onOpenAlbum, onPlayAlbum, accent }) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [hovCenter, setHovCenter] = useState(false);
  const containerRef = useRef(null);
  // Separate ref for width measurement — points at a stable wrapper
  // whose dimensions are determined by the parent layout, NOT by the
  // cards inside it. If we observe the same element that holds the
  // cards, changing the card size changes the container's height,
  // which fires the observer again, which changes the card size, and
  // so on — a visible "pulsing" feedback loop. Anchoring to a parent
  // breaks the cycle.
  const measureRef = useRef(null);

  // Measure the wrapper width with ResizeObserver so the stack scales
  // smoothly when the user resizes the dock panel. We compare against
  // the previous width and only update state if the change is ≥4px —
  // this prevents subpixel rounding from triggering re-renders in a
  // tight loop, and ignores height changes entirely (the observer
  // fires on any contentRect change, not just the dimension we care
  // about). Default 320 covers the first paint before the observer
  // has fired.
  const [containerWidth, setContainerWidth] = useState(320);
  const lastWidthRef = useRef(320);
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return undefined;
    const update = () => {
      const w = el.clientWidth || 320;
      if (Math.abs(w - lastWidthRef.current) >= 4) {
        lastWidthRef.current = w;
        setContainerWidth(w);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { cardSize: STACK_CARD_SIZE, cardGap: STACK_CARD_GAP } = computeStackMetrics(containerWidth);

  // Keep focusedIndex valid if the underlying albums list changes
  // (search filter, sort order swap, library refresh).
  useEffect(() => {
    if (focusedIndex >= albums.length) {
      setFocusedIndex(Math.max(0, albums.length - 1));
    }
  }, [albums.length, focusedIndex]);

  const flip = useCallback((delta) => {
    setFocusedIndex((i) => {
      const next = i + delta;
      if (next < 0) return 0;
      if (next >= albums.length) return albums.length - 1;
      return next;
    });
  }, [albums.length]);

  // Wheel handler: map both vertical and horizontal wheel/trackpad motion
  // onto stack movement. Most users have vertical-only wheels, so we
  // accept either axis. Debounced via lastWheelTs so a single trackpad
  // swipe doesn't fly through 20 albums.
  const lastWheelTsRef = useRef(0);
  const onWheel = useCallback((e) => {
    e.preventDefault();
    const now = performance.now();
    if (now - lastWheelTsRef.current < 90) return; // ~11 flips/sec ceiling
    lastWheelTsRef.current = now;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (d > 0) flip(1);
    else if (d < 0) flip(-1);
  }, [flip]);

  // Attach a non-passive wheel listener so we can preventDefault.
  // React's synthetic onWheel is passive by default in newer versions
  // and won't honor preventDefault — without this, vertical scrolls
  // would scroll the parent container instead of flipping cards.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const renderCard = (album, index) => {
    const offset = index - focusedIndex;
    const abs = Math.abs(offset);
    if (abs > STACK_RENDER_RADIUS) return null;

    const isCenter = offset === 0;
    const isActive = album.tracks.some((t) => t.id === currentTrack?.id);

    const x = Math.sign(offset) * (STACK_CARD_GAP * abs * 0.9);
    const scale = isCenter ? 1 : Math.max(0.5, 0.82 - abs * 0.05);
    const rotY = isCenter ? 0 : -Math.sign(offset) * Math.min(45, 22 + abs * 4);
    const opacity = isCenter ? 1 : Math.max(0, 0.85 - abs * 0.18);
    const z = STACK_RENDER_RADIUS - abs + 10;

    const transform = `
      translate3d(${x}px, 0, ${isCenter ? 0 : -abs * 40}px)
      rotateY(${rotY}deg)
      scale(${scale})
    `;

    const handleClick = () => {
      if (isCenter) onOpenAlbum(album.key);
      else setFocusedIndex(index);
    };

    return (
      <div
        key={album.key}
        onClick={handleClick}
        onMouseEnter={isCenter ? () => setHovCenter(true) : undefined}
        onMouseLeave={isCenter ? () => setHovCenter(false) : undefined}
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: STACK_CARD_SIZE,
          height: STACK_CARD_SIZE,
          marginLeft: -STACK_CARD_SIZE / 2,
          marginTop: -STACK_CARD_SIZE / 2,
          transform,
          transformStyle: 'preserve-3d',
          opacity,
          zIndex: z,
          cursor: 'pointer',
          transition: 'transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 320ms ease',
          willChange: 'transform, opacity',
          backfaceVisibility: 'hidden',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 12,
            overflow: 'hidden',
            background: '#111',
            border: `1px solid ${isActive ? `rgba(${accent},0.5)` : 'rgba(255,255,255,0.08)'}`,
            boxShadow: isCenter
              ? `0 30px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.05), 0 0 60px rgba(${accent},0.2)`
              : '0 16px 40px rgba(0,0,0,0.5)',
            position: 'relative',
          }}
        >
          <AlbumCover album={album} />

          {isActive && (
            <div style={{
              position: 'absolute', top: 10, right: 10,
              width: 10, height: 10, borderRadius: '50%',
              background: `rgb(${accent})`,
              boxShadow: `0 0 10px rgba(${accent},0.9)`,
            }} />
          )}

          {isCenter && hovCenter && (
            <div style={{
              position: 'absolute', inset: 0,
              background: 'rgba(0,0,0,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 12,
            }}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onPlayAlbum(album); }}
                title="Play album"
                style={{
                  width: 56, height: 56, borderRadius: '50%', border: 'none',
                  background: 'rgba(255,255,255,0.95)', color: '#000',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (albums.length === 0) {
    return (
      <div style={{
        padding: '40px 16px', textAlign: 'center',
        color: 'rgba(255,255,255,0.45)', fontSize: 12,
      }}>
        No albums to display
      </div>
    );
  }

  const focusedAlbum = albums[focusedIndex];

  return (
    <div
      ref={measureRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        paddingTop: 12,
      }}
    >
      {/* The 3D stage. perspective gives rotateY meaningful depth. */}
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: '100%',
          height: STACK_CARD_SIZE + 60,
          perspective: 1100,
          // Clip cards to the container edges. With responsive sizing the
          // side cards will mostly fit, but in narrow panels they can still
          // extend slightly beyond the edge — hidden overflow keeps the
          // layout tidy and prevents horizontal scrollbars from appearing.
          overflow: 'hidden',
        }}
      >
        {albums.map((album, i) => renderCard(album, i))}
      </div>

      {/* Label strip below the stack. key={focusedAlbum.key} triggers
         a fresh fade-in animation when the focus changes. */}
      <div style={{
        marginTop: 18,
        textAlign: 'center',
        minHeight: 60,
        pointerEvents: 'none',
      }}>
        <div key={focusedAlbum.key} style={{
          animation: 'albumStackLabelFade 240ms ease',
        }}>
          <div style={{
            fontSize: 16, fontWeight: 700, color: '#fff',
            letterSpacing: 0.2,
          }}>
            {focusedAlbum.album}
          </div>
          <div style={{
            fontSize: 12, color: 'rgba(255,255,255,0.55)',
            marginTop: 4,
          }}>
            {focusedAlbum.artist}
            <span style={{ color: 'rgba(255,255,255,0.3)' }}>
              {' · '}
              {focusedAlbum.tracks.length} {focusedAlbum.tracks.length === 1 ? 'track' : 'tracks'}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom nav buttons — discoverable affordance for users who
         don't think to scroll. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        marginTop: 8, pointerEvents: 'auto',
      }}>
        <button
          type="button"
          onClick={() => flip(-1)}
          disabled={focusedIndex === 0}
          aria-label="Previous album"
          style={stackNavBtnStyle(focusedIndex === 0)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z" />
          </svg>
        </button>
        <div style={{
          fontSize: 11, color: 'rgba(255,255,255,0.45)',
          fontVariantNumeric: 'tabular-nums', minWidth: 60, textAlign: 'center',
        }}>
          {focusedIndex + 1} / {albums.length}
        </div>
        <button
          type="button"
          onClick={() => flip(1)}
          disabled={focusedIndex >= albums.length - 1}
          aria-label="Next album"
          style={stackNavBtnStyle(focusedIndex >= albums.length - 1)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
          </svg>
        </button>
      </div>

      <style>{`
        @keyframes albumStackLabelFade {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function stackNavBtnStyle(disabled) {
  return {
    width: 32, height: 32, borderRadius: '50%',
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    color: disabled ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.7)',
    cursor: disabled ? 'default' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background 0.15s, color 0.15s',
  };
}

/** Two-button cluster — Grid / Stack. Sits above the album list. */
/**
 * AlbumViewToggle — segmented control for switching between grid and stack
 * album views. The inner button component is defined OUTSIDE the parent so
 * it has a stable identity across renders; if it were inline, every render
 * would create a new component reference, causing React to unmount and
 * remount the DOM button on each render. When that unmount happened
 * between a mousedown and the matching mouseup, the browser would never
 * fire the click event (clicks require both events on the same node), so
 * users would have to land a perfectly-still click on the element to make
 * it register. Hoisting Btn fixes that class of "only the center works"
 * bugs entirely.
 *
 * We also dispatch on `onMouseDown` rather than `onClick`. A mousedown
 * fires immediately as the pointer goes down, before any state churn that
 * a parent might cause, so even if the button remounts a moment later the
 * action has already been committed.
 */
function AlbumViewToggleBtn({ value, label, icon, active, onActivate }) {
  // Use onMouseDown for instant activation; onClick still fires for
  // keyboard / accessibility paths. Suppress the synthesized click that
  // follows mousedown so we don't double-fire onActivate.
  const handledRef = useRef(false);
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        // Only left-button activations.
        if (e.button !== 0) return;
        handledRef.current = true;
        onActivate(value);
      }}
      onClick={() => {
        if (handledRef.current) { handledRef.current = false; return; }
        onActivate(value);
      }}
      title={label}
      aria-label={label}
      aria-pressed={active}
      style={{
        width: 28, height: 24, borderRadius: 6, border: 'none',
        background: active ? 'rgba(255,255,255,0.12)' : 'transparent',
        color: active ? '#fff' : 'rgba(255,255,255,0.5)',
        cursor: 'pointer', padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      {icon}
    </button>
  );
}

function AlbumViewToggle({ mode, onChange }) {
  return (
    <div style={{
      display: 'inline-flex', gap: 2, padding: 2,
      background: 'rgba(255,255,255,0.04)', borderRadius: 8,
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <AlbumViewToggleBtn
        value="grid"
        label="Grid view"
        active={mode === 'grid'}
        onActivate={onChange}
        icon={
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z" />
          </svg>
        }
      />
      <AlbumViewToggleBtn
        value="stack"
        label="Stack view"
        active={mode === 'stack'}
        onActivate={onChange}
        icon={
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <rect x="3" y="6" width="10" height="12" rx="1.5" opacity="0.4" />
            <rect x="7" y="5" width="10" height="14" rx="1.5" opacity="0.7" />
            <rect x="11" y="4" width="10" height="16" rx="1.5" />
          </svg>
        }
      />
    </div>
  );
}

// Minimal ghost icon button for the secondary album actions. Quiet by default
// (muted icon, no chrome), lights up on hover. `tone="danger"` makes it red;
// `active` gives it a filled tint (armed-delete / toggled find-missing).
// Defined at module scope — NOT inside AlbumDetailView — so its component
// identity is stable across the album view's frequent re-renders (playback
// time ticks). A nested definition would remount these buttons every render,
// which wiped the imperative hover background and made it flicker.
function IconAction({ onClick, title, disabled, tone = 'default', active = false, children }) {
  const rgb = tone === 'danger' ? '243,114,114' : '255,255,255';
  const idle = tone === 'danger' ? 'rgba(243,114,114,0.78)' : 'rgba(255,255,255,0.55)';
  const lit = tone === 'danger' ? '#ffb3b3' : '#fff';
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      style={{
        width: 34, height: 34, borderRadius: 9, border: 'none', padding: 0,
        background: active ? `rgba(${rgb},0.2)` : 'transparent',
        color: active ? lit : idle,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.15s, color 0.15s',
      }}
      onMouseEnter={(e) => { if (!disabled && !active) { e.currentTarget.style.background = `rgba(${rgb},0.1)`; e.currentTarget.style.color = lit; } }}
      onMouseLeave={(e) => { if (!disabled && !active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = idle; } }}>
      {children}
    </button>
  );
}

function AlbumDetailView({ album, tracks, currentTrack, isPlaying, hovered, setHovered, selectedId, setSelectedId, onBack, onPlayTrack, onPlayPauseTrack, canRemove, onRemoveFromLibrary, canEdit, onEditTrack, canEditAlbum, onEditAlbum, canAddToPlaylist, onAddToPlaylist, onTrackContextMenu, accent, onDownloadMissing }) {
  const totalDuration = album.tracks.reduce((s, t) => s + (t.duration || 0), 0);
  const formatAlbumDuration = (sec) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h} hr ${m} min`;
    return m > 0 ? `${m} min` : '< 1 min';
  };

  // Reveal the play overlay only while the cover is hovered.
  const [coverHover, setCoverHover] = React.useState(false);

  // Two-step confirm for deleting the whole album: the first click arms the
  // button (and auto-disarms after a few seconds) so a stray click can't wipe
  // an album. The second click performs the removal and returns to the list.
  const [deleteArmed, setDeleteArmed] = React.useState(false);
  const deleteTimerRef = React.useRef(null);
  React.useEffect(() => () => { if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current); }, []);
  const handleDeleteAlbum = () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(() => setDeleteArmed(false), 3500);
      return;
    }
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    setDeleteArmed(false);
    onRemoveFromLibrary(album.tracks.map((t) => t.id));
    onBack?.();
  };

  // --- "Find missing tracks" feature -----------------------------------
  // Resolves this library album to a Spotify edition (backend scores the best
  // match + returns alternatives for the confirm/correct step), then lists the
  // tracks the user doesn't own with a per-track download action.
  const api = (typeof window !== 'undefined') ? window.electronAPI : null;
  const canFindMissing = !!(api?.albumResolveMissing);
  const [missingState, setMissingState] = useState('idle'); // idle | loading | done | error
  const [missingResult, setMissingResult] = useState(null); // resolver payload
  const [missingError, setMissingError] = useState('');
  const [showEditionPicker, setShowEditionPicker] = useState(false);
  // Per-missing-track download status: spotifyId -> 'queued'|'downloading'|'done'|'failed'
  const [dlStatus, setDlStatus] = useState({});

  const runResolve = useCallback(async (forcedAlbumId) => {
    if (!api?.albumResolveMissing) return;
    setMissingState('loading');
    setMissingError('');
    setShowEditionPicker(false);
    try {
      const res = await api.albumResolveMissing({
        album: album.album,
        artist: album.artist,
        ownedTitles: album.tracks.map((t) => t.title).filter(Boolean),
        albumId: forcedAlbumId || '',
      });
      if (!res?.ok) {
        setMissingState('error');
        setMissingError(res?.error || 'Could not look up this album.');
        return;
      }
      setMissingResult(res);
      setMissingState('done');
    } catch (e) {
      setMissingState('error');
      setMissingError(String(e?.message || e));
    }
  }, [api, album]);

  // Pick a specific edition from the alternatives, confirm + remember it.
  const chooseEdition = useCallback(async (alt) => {
    if (!api) return;
    try {
      await api.albumConfirmLink?.({
        album: album.album, artist: album.artist, albumId: alt.albumId, confirmed: true,
      });
    } catch { /* non-fatal */ }
    runResolve(alt.albumId);
  }, [api, album, runResolve]);

  const downloadMissing = useCallback((track) => {
    if (!onDownloadMissing) return;
    const id = track.spotifyId || track.title;
    setDlStatus((s) => ({ ...s, [id]: 'queued' }));
    onDownloadMissing(track, {
      album: missingResult?.resolved?.name || album.album,
      artist: album.artist,
      albumArtUrl: missingResult?.resolved?.albumArtUrl || '',
      onStatus: (status) => setDlStatus((s) => ({ ...s, [id]: status })),
    });
  }, [onDownloadMissing, missingResult, album]);

  const missingCount = missingResult?.missing?.length || 0;

  // When search is filtering tracks, we only show the filtered subset.
  // Otherwise we use the full album structure (so discs are visible).
  const searchActive = tracks.length !== album.tracks.length;

  // Renders a single row — reused across flat and disc-grouped layouts.
  const renderTrackRow = (track, displayIndex) => {
    const isCur = currentTrack?.id === track.id;
    const isSel = selectedId === track.id;
    const isHov = hovered === track.id;
    return (
      <div key={track.id}
        onMouseEnter={() => setHovered(track.id)}
        onMouseLeave={() => setHovered(null)}
        onClick={() => setSelectedId(track.id)}
        onDoubleClick={() => onPlayTrack(track)}
        onContextMenu={onTrackContextMenu ? (e) => onTrackContextMenu(e, track) : undefined}
        style={{ display: 'grid', gridTemplateColumns: '22px 1fr auto', alignItems: 'center', gap: 8, padding: '5px 8px', cursor: 'pointer', borderRadius: 8, background: isCur ? `rgba(${accent},0.22)` : isSel ? 'rgba(255,255,255,0.05)' : isHov ? 'rgba(255,255,255,0.035)' : 'transparent' }}>
        <div style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isCur ? '#fff' : 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
          {(isHov || isCur) ? (
            <button type="button" title={isCur && isPlaying ? 'Pause' : 'Play'}
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); (onPlayPauseTrack || onPlayTrack)(track); }}
              style={{ width: 20, height: 20, border: 'none', background: 'transparent', color: '#fff', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ transform: 'scale(0.72)' }}>{isCur && isPlaying ? <Icons.Pause /> : <Icons.Play />}</span>
            </button>
          ) : (
            // Show the actual track number if we have it, otherwise the display index
            String(track.trackNumber != null ? track.trackNumber : displayIndex).padStart(2, '0')
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: isCur ? '#fff' : 'rgba(255,255,255,0.9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title || 'Untitled'}</span>
            {track.explicit === 1 ? <ExplicitBadge /> : null}
          </div>
        </div>
        {isHov && (canEdit || canRemove || canAddToPlaylist) ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            {canAddToPlaylist ? (
              <button type="button" title="Add to playlist"
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onAddToPlaylist([track.id], e.currentTarget); }}
                style={{ width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, lineHeight: 1, fontWeight: 300, padding: 0 }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; e.currentTarget.style.background = 'transparent'; }}>
                +
              </button>
            ) : null}
            {canEdit ? (
              <button type="button" title="Edit metadata"
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onEditTrack(track.id); }}
                style={{ width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; e.currentTarget.style.background = 'transparent'; }}>
                <span style={{ transform: 'scale(0.75)' }}><Icons.Edit /></span>
              </button>
            ) : null}
            {canRemove ? (
              <button type="button" title="Remove from library"
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onRemoveFromLibrary([track.id]); }}
                style={{ width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#f37272'; e.currentTarget.style.background = 'rgba(243,114,114,0.1)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; e.currentTarget.style.background = 'transparent'; }}>
                <span style={{ transform: 'scale(0.8)' }}><Icons.Trash /></span>
              </button>
            ) : null}
          </div>
        ) : (
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            {track.duration ? formatTime(track.duration) : ''}
          </span>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Album hero header */}
      <div style={{ display: 'flex', gap: 10, padding: '4px 6px 12px', alignItems: 'flex-start' }}>
        {/* Back button + cover */}
        <div style={{ position: 'relative', flexShrink: 0 }}
          onMouseEnter={() => setCoverHover(true)}
          onMouseLeave={() => setCoverHover(false)}>
          <button type="button" onClick={onBack}
            title="Back to albums"
            style={{ position: 'absolute', top: -6, left: -6, zIndex: 2, width: 22, height: 22, borderRadius: 7, border: 'none', background: 'rgba(0,0,0,0.6)', color: 'rgba(255,255,255,0.8)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, backdropFilter: 'blur(6px)' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
          </button>
          <div style={{ width: 64, height: 64, borderRadius: 8, overflow: 'hidden', background: '#111', boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}>
            <AlbumCover album={album} showDiscBadge={false} />
          </div>
          {/* Hover-to-play — a scrim that fades in over the cover with a
              centered accent play button. Clicking anywhere on the hovered
              cover starts the album. The play path is drawn box-centered in
              its viewBox (apex at x=16.5, base at x=7.5 → midpoint 12) so the
              glyph sits dead center with no transform nudge. */}
          <button type="button"
            onClick={() => onPlayTrack(album.tracks[0])}
            title="Play album"
            aria-label="Play album"
            style={{
              position: 'absolute', inset: 0, zIndex: 1, border: 'none', padding: 0,
              borderRadius: 8, cursor: 'pointer',
              background: 'rgba(0,0,0,0.46)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: coverHover ? 1 : 0,
              pointerEvents: coverHover ? 'auto' : 'none',
              transition: 'opacity 0.15s ease',
            }}>
            <span style={{
              width: 30, height: 30, borderRadius: '50%', background: `rgb(${accent})`, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transform: coverHover ? 'scale(1)' : 'scale(0.85)',
              transition: 'transform 0.15s ease',
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'block' }}>
                <path d="M7.5 5.5v13l9-6.5z" />
              </svg>
            </span>
          </button>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>{album.album}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{album.artist}</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>
            {album.tracks.length} tracks
            {album.hasMultipleDiscs ? ` · ${album.discs.length} discs` : ''}
            {' · '}{formatAlbumDuration(totalDuration)}
          </div>
          {/* Secondary actions — quiet ghost icons (Play lives up next to the
              metadata). The destructive delete is set apart by a hairline
              divider and morphs to a check when armed so a second click
              clearly confirms. */}
          {(canEditAlbum || canAddToPlaylist || canFindMissing || canRemove) ? (
          <div style={{ display: 'flex', gap: 4, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {canEditAlbum ? (
              <IconAction
                title="Edit album metadata"
                onClick={() => onEditAlbum({
                  album: album.album,
                  artist: album.artist,
                  coverArt: album.coverArt,
                  trackIds: album.tracks.map((t) => t.id),
                  sampleTrack: album.tracks[0],
                  discNumber: null, // null = whole-album scope
                })}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
              </IconAction>
            ) : null}

            {canAddToPlaylist ? (
              <IconAction
                title="Add album to playlist"
                onClick={(e) => onAddToPlaylist(album.tracks.map((t) => t.id), e.currentTarget)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={{ display: 'block' }}>
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </IconAction>
            ) : null}

            {canFindMissing ? (
              <IconAction
                title={missingState === 'done' ? 'Hide missing tracks' : "Find tracks you don't have yet"}
                disabled={missingState === 'loading'}
                active={missingState === 'done'}
                onClick={() => { if (missingState === 'done') { setMissingState('idle'); setMissingResult(null); } else { runResolve(); } }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
              </IconAction>
            ) : null}

            {canRemove ? (
              <>
                <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.1)', margin: '0 3px' }} />
                <IconAction
                  tone="danger"
                  active={deleteArmed}
                  title={deleteArmed ? 'Click again to confirm — removes every track in this album' : 'Delete album from library'}
                  onClick={handleDeleteAlbum}>
                  {deleteArmed ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  )}
                </IconAction>
              </>
            ) : null}
          </div>
          ) : null}
        </div>
      </div>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '0 6px 6px' }} />

      {/* Track list — grouped by disc when multi-disc (and not search-filtered) */}
      {tracks.length === 0 ? (
        <div style={{ padding: '16px', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>No matching tracks</div>
      ) : (album.hasMultipleDiscs && !searchActive) ? (
        album.discs.map((disc) => (
          <div key={disc.discNumber}>
            {/* Disc section header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 8px 6px', marginTop: disc.discNumber === album.discs[0].discNumber ? 0 : 6,
            }}>
              <div style={{
                width: 26, height: 26, borderRadius: 5, overflow: 'hidden',
                background: '#111', flexShrink: 0,
                boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
              }}>
                {disc.coverArt ? (
                  <img src={disc.coverArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2a2a2a' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>
                  </div>
                )}
              </div>
              <div style={{
                fontSize: 10.5, fontWeight: 700, color: 'rgba(255,255,255,0.75)',
                letterSpacing: '0.05em', textTransform: 'uppercase',
              }}>
                Disc {disc.discNumber}
              </div>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
              {canEditAlbum ? (
                <button type="button"
                  onClick={() => onEditAlbum({
                    album: album.album,
                    artist: album.artist,
                    coverArt: disc.coverArt || album.coverArt,
                    trackIds: disc.tracks.map((t) => t.id),
                    sampleTrack: disc.tracks[0],
                    discNumber: disc.discNumber,
                  })}
                  title={`Edit disc ${disc.discNumber} metadata`}
                  style={{
                    width: 20, height: 20, borderRadius: 5, border: 'none',
                    background: 'transparent', color: 'rgba(255,255,255,0.4)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: 0,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.background = 'transparent'; }}>
                  <span style={{ transform: 'scale(0.7)', display: 'flex' }}><Icons.Edit /></span>
                </button>
              ) : null}
              <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.35)', fontVariantNumeric: 'tabular-nums' }}>
                {disc.tracks.length} {disc.tracks.length === 1 ? 'track' : 'tracks'}
              </div>
            </div>
            {disc.tracks.map((track, i) => renderTrackRow(track, i + 1))}
          </div>
        ))
      ) : (
        tracks.map((track, i) => renderTrackRow(track, i + 1))
      )}

      {/* ---- Missing tracks section ---- */}
      {missingState === 'error' ? (
        <div style={{ margin: '10px 6px 4px', padding: '10px 12px', borderRadius: 10, background: 'rgba(243,114,114,0.08)', border: '1px solid rgba(243,114,114,0.18)', fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>
          {missingError || 'Could not look up this album.'}
        </div>
      ) : null}

      {missingState === 'done' && missingResult ? (
        <div style={{ marginTop: 10 }}>
          {/* Resolved-edition bar + confirm/correct affordance */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            padding: '8px 10px', margin: '0 6px 8px', borderRadius: 10,
            background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)' }}>
              Matched to{' '}
              <span style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 600 }}>{missingResult.resolved?.name}</span>
              {missingResult.resolved?.releaseDate ? <span style={{ color: 'rgba(255,255,255,0.4)' }}>{` · ${String(missingResult.resolved.releaseDate).slice(0, 4)}`}</span> : null}
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>{` · ${missingResult.resolved?.totalTracks || 0} tracks`}</span>
              {missingResult.confirmed ? <span style={{ color: `rgba(${accent},0.9)`, marginLeft: 6, fontWeight: 600 }}>✓ confirmed</span> : null}
            </span>
            {(missingResult.alternatives?.length || 0) > 1 ? (
              <button type="button"
                onClick={() => setShowEditionPicker((v) => !v)}
                style={{ marginLeft: 'auto', padding: '3px 9px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; e.currentTarget.style.background = 'transparent'; }}>
                {showEditionPicker ? 'Close' : 'Wrong album?'}
              </button>
            ) : null}
          </div>

          {/* Edition picker */}
          {showEditionPicker ? (
            <div style={{ margin: '0 6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {missingResult.alternatives.map((alt) => {
                const isCurrent = alt.albumId === missingResult.resolved?.albumId;
                return (
                  <button key={alt.albumId} type="button"
                    onClick={() => chooseEdition(alt)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                      padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
                      border: isCurrent ? `1px solid rgba(${accent},0.5)` : '1px solid rgba(255,255,255,0.07)',
                      background: isCurrent ? `rgba(${accent},0.12)` : 'rgba(255,255,255,0.02)',
                    }}
                    onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                    onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{alt.name}</div>
                      <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>
                        {alt.totalTracks} tracks{alt.releaseDate ? ` · ${String(alt.releaseDate).slice(0, 4)}` : ''} · {Math.round((alt.score || 0) * 100)}% match
                      </div>
                    </div>
                    {isCurrent ? <span style={{ fontSize: 9.5, color: `rgba(${accent},0.9)`, fontWeight: 700 }}>current</span> : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          {/* Section header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px 6px' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>
              {missingCount === 0 ? 'Complete album' : `${missingCount} missing ${missingCount === 1 ? 'track' : 'tracks'}`}
            </span>
            {missingCount > 0 ? (
              <span style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.35)' }}>· not in your library</span>
            ) : null}
          </div>

          {missingCount === 0 ? (
            <div style={{ padding: '4px 8px 10px', fontSize: 10.5, color: 'rgba(255,255,255,0.45)' }}>
              You have every track from this edition.
            </div>
          ) : (
            missingResult.missing.map((mt) => {
              const id = mt.spotifyId || mt.title;
              const st = dlStatus[id];
              return (
                <div key={id}
                  style={{ display: 'grid', gridTemplateColumns: '22px 1fr auto', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 8, opacity: st === 'done' ? 0.5 : 1 }}>
                  <div style={{ width: 22, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                    {String(mt.trackNumber || '').padStart(2, '0') || '–'}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{mt.title}</span>
                      {mt.explicit ? <ExplicitBadge /> : null}
                    </div>
                  </div>
                  {st === 'done' ? (
                    <span style={{ fontSize: 10, color: `rgba(${accent},0.9)`, fontWeight: 600, flexShrink: 0 }}>✓ added</span>
                  ) : st === 'downloading' || st === 'queued' ? (
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', flexShrink: 0 }}>{st === 'queued' ? 'queued…' : 'downloading…'}</span>
                  ) : st === 'failed' ? (
                    <button type="button" onClick={() => downloadMissing(mt)}
                      title="Download failed — retry"
                      style={{ padding: '3px 10px', borderRadius: 8, border: '1px solid rgba(243,114,114,0.3)', background: 'rgba(243,114,114,0.1)', color: '#f3a0a0', fontSize: 10, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
                      Retry
                    </button>
                  ) : (
                    <button type="button" onClick={() => downloadMissing(mt)}
                      title="Download this track via Soulseek"
                      disabled={!onDownloadMissing}
                      style={{ padding: '3px 10px', borderRadius: 8, border: `1px solid rgba(${accent},0.4)`, background: `rgba(${accent},0.16)`, color: '#fff', fontSize: 10, fontWeight: 600, cursor: onDownloadMissing ? 'pointer' : 'default', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                      onMouseEnter={(e) => { if (onDownloadMissing) e.currentTarget.style.background = `rgba(${accent},0.28)`; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = `rgba(${accent},0.16)`; }}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                        <path d="M12 3v12" /><path d="M7 11l5 5 5-5" /><path d="M5 21h14" />
                      </svg>
                      Get
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </>
  );
}


export { AlbumCover, AlbumGridView, AlbumStackView, AlbumViewToggleBtn, AlbumViewToggle, AlbumDetailView };
