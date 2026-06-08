import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';

function QueueDrawer({
  open,
  onClose,
  queue,
  currentIndex,
  onJumpToQueueIndex,
  onRemoveFromQueue,
  onReorderQueue,
  onClearUpNext,
  accent,
}) {
  // Height as a fraction of viewport (0..1). Drives the transform.
  const [heightFrac, setHeightFrac] = useState(QUEUE_DRAWER_SNAPS.DEFAULT);
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef({ y: 0, frac: 0 });

  // Reset to default height every time the drawer opens (so a previous
  // expanded state doesn't surprise the user later).
  useEffect(() => {
    if (open) setHeightFrac(QUEUE_DRAWER_SNAPS.DEFAULT);
  }, [open]);

  // Escape key closes
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Pointer-based drag on the handle at the top of the drawer
  const onHandlePointerDown = (e) => {
    e.preventDefault();
    setDragging(true);
    dragStartRef.current = { y: e.clientY, frac: heightFrac };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onHandlePointerMove = (e) => {
    if (!dragging) return;
    const vh = window.innerHeight || 800;
    const dy = dragStartRef.current.y - e.clientY;     // up = positive
    const next = Math.max(0, Math.min(0.95, dragStartRef.current.frac + dy / vh));
    setHeightFrac(next);
  };
  const onHandlePointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    // Snap to nearest of 0 / DEFAULT / EXPANDED.
    const f = heightFrac;
    if (f < 0.18) { onClose?.(); return; }       // dragged way down → close
    const candidates = [QUEUE_DRAWER_SNAPS.DEFAULT, QUEUE_DRAWER_SNAPS.EXPANDED];
    const closest = candidates.reduce((best, c) => Math.abs(c - f) < Math.abs(best - f) ? c : best, candidates[0]);
    setHeightFrac(closest);
  };

  // Render even when closed so the slide-out transition has somewhere to go.
  // Visibility is controlled by transform + opacity below.
  const visibleFrac = open ? heightFrac : 0;
  const heightCss = `${visibleFrac * 100}vh`;

  return (
    <>
      {/* Backdrop — dims the rest of the app and catches outside clicks */}
      <div
        onClick={onClose}
        aria-hidden={!open}
        style={{
          position: 'absolute', inset: 0, zIndex: 40,
          background: 'rgba(0, 0, 0, 0.55)',
          backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: dragging ? 'none' : 'opacity 280ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-label="Play queue"
        aria-hidden={!open}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          height: heightCss,
          zIndex: 41,
          display: 'flex', flexDirection: 'column',
          background: 'rgba(18, 18, 20, 0.92)',
          backdropFilter: 'blur(18px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(18px) saturate(1.4)',
          borderTop: `1px solid rgba(${accent}, 0.18)`,
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          boxShadow: '0 -20px 60px rgba(0, 0, 0, 0.5)',
          // Animate height when not actively dragging. Dragging needs to
          // follow the cursor 1:1 so we kill the transition then.
          transition: dragging ? 'none' : 'height 320ms cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: 'hidden',
        }}
      >
        {/* Drag handle — visible bar at the top, pointer-draggable */}
        <div
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          style={{
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            padding: '10px 0 6px', cursor: dragging ? 'grabbing' : 'grab',
            flexShrink: 0,
            touchAction: 'none',
          }}
          title="Drag to resize, or pull down to close"
        >
          <div style={{
            width: 44, height: 4, borderRadius: 2,
            background: 'rgba(255, 255, 255, 0.25)',
          }} />
        </div>

        {/* Reuse QueueTab as the body — same virtualized list that worked in
            the dock version. The drawer's height fills around it. */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <QueueTab
            queue={queue}
            currentIndex={currentIndex}
            onJumpToQueueIndex={onJumpToQueueIndex}
            onRemoveFromQueue={onRemoveFromQueue}
            onReorderQueue={onReorderQueue}
            onClearUpNext={onClearUpNext}
            accent={accent}
          />
        </div>
      </div>
    </>
  );
}

/**
 * QueueHandle — the always-visible bottom-center pull tab. Sits flat against
 * the bottom edge of the window. Clicking opens the drawer; the count badge
 * shows how many tracks are queued so the user knows there's something there.
 */
function QueueHandle({ count, onOpen, accent }) {
  const [hovered, setHovered] = useState(false);
  const hasContent = count > 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={hasContent ? `Queue · ${count} tracks` : 'Queue'}
      aria-label="Open queue"
      style={{
        position: 'absolute', bottom: 0, left: '50%',
        transform: `translate(-50%, ${hovered ? '-2px' : '0'})`,
        zIndex: 30,
        // Pill-shaped tab that protrudes upward from the very bottom edge
        width: 96, height: hovered ? 18 : 14,
        borderTopLeftRadius: 10, borderTopRightRadius: 10,
        borderBottomLeftRadius: 0, borderBottomRightRadius: 0,
        border: 'none',
        borderTop: `1px solid rgba(${accent}, ${hasContent ? 0.4 : 0.18})`,
        borderLeft: `1px solid rgba(255, 255, 255, 0.06)`,
        borderRight: `1px solid rgba(255, 255, 255, 0.06)`,
        background: hovered
          ? `rgba(${accent}, 0.25)`
          : (hasContent ? 'rgba(28, 28, 32, 0.85)' : 'rgba(20, 20, 22, 0.65)'),
        backdropFilter: 'blur(14px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(14px) saturate(1.3)',
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        padding: 0,
        transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: hovered ? '0 -4px 16px rgba(0, 0, 0, 0.4)' : '0 -2px 8px rgba(0, 0, 0, 0.25)',
      }}
    >
      {/* Pill indicator */}
      <div style={{
        width: 28, height: 3, borderRadius: 2,
        background: hasContent ? `rgba(${accent}, 0.95)` : 'rgba(255, 255, 255, 0.35)',
        transition: 'background 200ms',
      }} />
      {/* Count, only when there's something to show — appears when hovered */}
      {hasContent && hovered ? (
        <span style={{
          fontSize: 9.5, fontWeight: 700, color: '#fff',
          letterSpacing: '0.04em',
        }}>{count > 99 ? '99+' : count}</span>
      ) : null}
    </button>
  );
}


/* =========================================================================
 *  QueueTab — shows the current play queue (Now + Up Next).
 *
 *  The queue IS the playback order: no hidden "context" behind it. Every row
 *  is either (a) the currently-playing track, (b) something coming up, or (c)
 *  something already played and still sitting in history. Users can jump to
 *  any index, drag to reorder, click × to remove, or clear everything after
 *  current with "Clear up next".
 * ========================================================================= */

function QueueTab({
  queue,
  currentIndex,
  onJumpToQueueIndex,
  onRemoveFromQueue,
  onReorderQueue,
  onClearUpNext,
  accent,
  // When painterAvailable is true, a list/painter view-mode toggle appears
  // at the top of the tab. Reading from localStorage preserves the user's
  // last choice across launches. When false, only the list view renders.
  painterAvailable = false,
  // Live audio currentTime — only needed by the painter to render the
  // playhead inside the current track's strip cell. List view ignores it.
  currentTime = 0,
}) {
  // View mode: 'list' (default — the original virtualized vertical list)
  // or 'painter' (horizontal duration-proportional strip).
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window === 'undefined') return 'list';
    return window.localStorage.getItem('immerse:queueViewMode') || 'list';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('immerse:queueViewMode', viewMode);
    }
  }, [viewMode]);
  // If painter gets disabled while it's active, fall back to list so the
  // user doesn't end up with an invisible queue.
  useEffect(() => {
    if (!painterAvailable && viewMode === 'painter') setViewMode('list');
  }, [painterAvailable, viewMode]);

  const [dragging, setDragging] = useState(null);      // index being dragged
  const [dragOver, setDragOver] = useState(null);      // index being hovered

  // Virtualization state — render only rows currently visible in the scroll
  // viewport. With queues of 500+ tracks (e.g. "play all" on a large library),
  // rendering every row up-front was making the queue open slowly and laggy
  // to scroll. Fixed 50px row height makes the math trivial.
  const ROW_H = 50;
  const OVERSCAN = 5;
  const scrollRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(600);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    setScrollTop(el.scrollTop);
    // Measure viewport with a ResizeObserver so we stay correct when the dock
    // resizes or an overlay (like a modal) changes the layout.
    // Guard: ignore zero-height measurements (element hidden/animating in) —
    // keep the previous value instead of collapsing the visible window.
    let ro;
    const measure = () => {
      const h = el.clientHeight;
      if (h > 0) setViewHeight(h);
    };
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    measure();
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (ro) ro.disconnect();
    };
  }, []);

  // When current track changes, auto-scroll it into view (gently). Runs only
  // when the queue tab is mounted, so it doesn't re-scroll on every tab switch
  // elsewhere in the app.
  const lastCurrentRef = useRef(currentIndex);
  useEffect(() => {
    if (currentIndex === lastCurrentRef.current) return;
    lastCurrentRef.current = currentIndex;
    const el = scrollRef.current;
    if (!el || currentIndex < 0) return;
    const rowTop = currentIndex * ROW_H;
    const rowBottom = rowTop + ROW_H;
    const viewTop = el.scrollTop;
    const viewBottom = viewTop + el.clientHeight;
    // Only scroll if the row isn't already comfortably in view
    if (rowTop < viewTop || rowBottom > viewBottom) {
      el.scrollTo({
        top: Math.max(0, rowTop - el.clientHeight / 2 + ROW_H / 2),
        behavior: 'smooth',
      });
    }
  }, [currentIndex]);

  const upNextCount = Math.max(0, queue.length - currentIndex - 1);
  const historyCount = Math.max(0, currentIndex);

  const handleDragStart = (index) => (e) => {
    setDragging(index);
    try { e.dataTransfer.effectAllowed = 'move'; } catch { /* ignore */ }
  };
  const handleDragOver = (index) => (e) => {
    e.preventDefault();
    if (dragOver !== index) setDragOver(index);
  };
  const handleDragEnd = () => { setDragging(null); setDragOver(null); };
  const handleDrop = (index) => (e) => {
    e.preventDefault();
    if (dragging != null && dragging !== index) onReorderQueue?.(dragging, index);
    handleDragEnd();
  };

  // Compute visible slice
  const total = queue.length;
  const firstVisible = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const lastVisible = Math.min(total, Math.ceil((scrollTop + viewHeight) / ROW_H) + OVERSCAN);
  const visibleRows = [];
  for (let i = firstVisible; i < lastVisible; i += 1) {
    visibleRows.push({ track: queue[i], index: i });
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 12px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.04em' }}>
            Queue
          </div>
          <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.45)', marginTop: 1 }}>
            {queue.length === 0 ? 'Empty' : (
              <>
                {historyCount > 0 ? `${historyCount} played · ` : ''}
                {upNextCount} up next
              </>
            )}
          </div>
        </div>
        {upNextCount > 0 ? (
          <button type="button" onClick={onClearUpNext}
            title="Remove everything after the current track"
            style={{
              padding: '4px 10px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.12)',
              background: 'transparent', color: 'rgba(255,255,255,0.65)',
              fontSize: 10, fontWeight: 600, cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#f37272'; e.currentTarget.style.borderColor = 'rgba(243,114,114,0.4)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.65)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}>
            Clear up next
          </button>
        ) : null}
        {/* List/painter toggle — only present when the painter feature is
           enabled in Settings. The two icon buttons are styled the same as
           the album grid/stack toggle for visual consistency. */}
        {painterAvailable ? (
          <QueueViewToggle mode={viewMode} onChange={setViewMode} />
        ) : null}
      </div>
      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />
      {/* Keyframes for the playing-indicator bars — defined once, not per row. */}
      <style>{`
        @keyframes immerseBar { 0%, 100% { transform: scaleY(0.4); } 50% { transform: scaleY(1); } }
      `}</style>

      {viewMode === 'painter' && painterAvailable ? (
        <QueuePainterView
          queue={queue}
          currentIndex={currentIndex}
          currentTime={currentTime}
          accent={accent}
          onJumpToQueueIndex={onJumpToQueueIndex}
          onRemoveFromQueue={onRemoveFromQueue}
          onReorderQueue={onReorderQueue}
        />
      ) : (
      /* Body — virtualized. Inner spacer forces the correct scrollbar size;
          each visible row is absolutely positioned at its real index. */
      <div ref={scrollRef}
        style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', position: 'relative' }}>
        {queue.length === 0 ? (
          <div style={{ padding: '28px 18px', textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 11.5, lineHeight: 1.6 }}>
            No tracks queued.
            <div style={{ marginTop: 6, fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
              Play something from the library and it'll show up here.
            </div>
          </div>
        ) : (
          <div style={{ height: total * ROW_H + 16, position: 'relative' }}>
            {visibleRows.map(({ track: t, index: i }) => {
              const isCurrent = i === currentIndex;
              const isHistory = i < currentIndex;
              const isDrop = dragOver === i && dragging !== i && dragging != null;
              return (
                <div key={`${t.id}:${i}`}
                  draggable
                  onDragStart={handleDragStart(i)}
                  onDragOver={handleDragOver(i)}
                  onDragEnd={handleDragEnd}
                  onDrop={handleDrop(i)}
                  style={{
                    position: 'absolute', top: i * ROW_H, left: 6, right: 6,
                    height: ROW_H - 2,
                    display: 'flex', alignItems: 'center', gap: 9,
                    padding: '5px 8px', borderRadius: 8,
                    background: isCurrent ? `rgba(${accent},0.15)` : 'transparent',
                    borderTop: isDrop ? `2px solid rgba(${accent},0.9)` : '2px solid transparent',
                    opacity: isHistory ? 0.45 : 1,
                    cursor: 'grab',
                    transition: 'background 0.12s, opacity 0.12s',
                  }}
                  onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                  onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = 'transparent'; }}>
                  {/* Cover art */}
                  <button type="button"
                    onClick={() => onJumpToQueueIndex?.(i)}
                    title={isCurrent ? 'Now playing' : `Jump to "${t.title}"`}
                    style={{
                      width: 36, height: 36, borderRadius: 5, overflow: 'hidden',
                      background: '#1a1a1a', border: 'none', padding: 0, flexShrink: 0,
                      cursor: 'pointer', position: 'relative',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                    }}>
                    {t.coverArt ? (
                      <img src={t.coverArt} alt="" loading="lazy" decoding="async"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : null}
                    {/* Playing indicator bars */}
                    {isCurrent ? (
                      <div style={{
                        position: 'absolute', inset: 0,
                        background: 'rgba(0,0,0,0.45)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2,
                      }}>
                        <div style={{ width: 2, height: 10, background: '#fff', borderRadius: 1, animation: 'immerseBar 0.9s ease-in-out infinite' }} />
                        <div style={{ width: 2, height: 10, background: '#fff', borderRadius: 1, animation: 'immerseBar 0.9s ease-in-out 0.25s infinite' }} />
                        <div style={{ width: 2, height: 10, background: '#fff', borderRadius: 1, animation: 'immerseBar 0.9s ease-in-out 0.5s infinite' }} />
                      </div>
                    ) : null}
                  </button>
                  {/* Title / artist */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 11.5, fontWeight: isCurrent ? 700 : 500,
                      color: isCurrent ? '#fff' : 'rgba(255,255,255,0.88)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {t.title || 'Untitled'}
                    </div>
                    <div style={{
                      fontSize: 10, color: 'rgba(255,255,255,0.55)', marginTop: 1,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {t.artist || 'Unknown Artist'}
                    </div>
                  </div>
                  {/* Remove button — hidden for the current track (use prev/next transport instead) */}
                  {!isCurrent ? (
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); onRemoveFromQueue?.(i); }}
                      title="Remove from queue" aria-label="Remove"
                      style={{
                        width: 22, height: 22, borderRadius: 5, border: 'none',
                        background: 'transparent', color: 'rgba(255,255,255,0.35)',
                        cursor: 'pointer', flexShrink: 0, padding: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'color 0.12s, background 0.12s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#f37272'; e.currentTarget.style.background = 'rgba(243,114,114,0.08)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.35)'; e.currentTarget.style.background = 'transparent'; }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

/** Small two-button toggle for QueueTab — list / painter modes.
 *  Same visual vocabulary as the album grid/stack toggle. */
/**
 * QueueViewToggle — segmented control for List / Painter queue views.
 * See AlbumViewToggle's leading comment for why the button component is
 * hoisted out of the parent and why activation runs on mousedown.
 */
function QueueViewToggleBtn({ value, label, icon, active, onActivate }) {
  const handledRef = useRef(false);
  return (
    <button
      type="button"
      onMouseDown={(e) => {
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
        width: 26, height: 22, borderRadius: 5, border: 'none',
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

function QueueViewToggle({ mode, onChange }) {
  return (
    <div style={{
      display: 'inline-flex', gap: 2, padding: 2,
      background: 'rgba(255,255,255,0.04)', borderRadius: 6,
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <QueueViewToggleBtn
        value="list"
        label="List view"
        active={mode === 'list'}
        onActivate={onChange}
        icon={
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="6" y1="6" x2="20" y2="6" />
            <line x1="6" y1="12" x2="20" y2="12" />
            <line x1="6" y1="18" x2="20" y2="18" />
            <circle cx="3.5" cy="6" r="0.8" fill="currentColor" />
            <circle cx="3.5" cy="12" r="0.8" fill="currentColor" />
            <circle cx="3.5" cy="18" r="0.8" fill="currentColor" />
          </svg>
        }
      />
      <QueueViewToggleBtn
        value="painter"
        label="Painter view"
        active={mode === 'painter'}
        onActivate={onChange}
        icon={
          /* Three rounded rectangles of varying width — represents the
             duration-proportional strip metaphor. */
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <rect x="2" y="9" width="6" height="6" rx="1.2" />
            <rect x="9" y="9" width="10" height="6" rx="1.2" opacity="0.7" />
            <rect x="20" y="9" width="3" height="6" rx="1.2" opacity="0.4" />
          </svg>
        }
      />
    </div>
  );
}


/**
 * QueuePainterView — horizontal strip showing the queue as duration-
 * proportional blocks. Each track is rendered as a rounded rectangle
 * whose width is its `duration` value, scaled to fit the viewport.
 *
 * Visual encoding:
 *   - Played tracks (index < currentIndex): dimmed at 35% opacity
 *   - Current track: full opacity with accent-tinted glow + playhead
 *     cursor showing real-time position via `currentTime`
 *   - Up-next tracks: full opacity, no highlight
 *   - Hovered track: shows track title + artist as a small overlay
 *
 * Interactions:
 *   - Click a track block to jump to it (calls onJumpToQueueIndex)
 *   - Right-click to remove from queue (onRemoveFromQueue)
 *   - Drag-reorder: drag a block horizontally and drop on another to
 *     swap positions. Uses native HTML5 drag/drop to match the list view's
 *     reorder behavior — no custom pointer state needed.
 *
 * Sizing math:
 *   The strip wraps to multiple rows if the queue is long. Each row is
 *   `ROW_HEIGHT` tall. The width per second is computed so each row
 *   approximately fills the viewport; tracks longer than the remaining
 *   row space wrap to the next row. Minimum block width is 24px so a
 *   30-second interlude doesn't disappear entirely.
 *
 * Performance:
 *   For queues under ~500 tracks this is fine to render all at once
 *   (each block is ~30 DOM nodes including text). Larger queues would
 *   benefit from virtualization but in practice queues rarely exceed
 *   100 tracks during a session.
 */
function QueuePainterView({
  queue, currentIndex, currentTime, accent,
  onJumpToQueueIndex, onRemoveFromQueue, onReorderQueue,
}) {
  const containerRef = useRef(null);
  // Measured container width — drives the seconds-per-pixel scale. Falls
  // back to a sensible default while the ResizeObserver hasn't fired yet.
  const [containerWidth, setContainerWidth] = useState(320);
  // Stable last-width ref to suppress sub-4px observer noise (same trick
  // used in the album stack to avoid feedback loops).
  const lastWidthRef = useRef(320);
  useLayoutEffect(() => {
    const el = containerRef.current;
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

  // Drag-reorder state. We use HTML5 drag (matches list view) so the user
  // can drag from list view to painter view and back without disorientation.
  const [dragging, setDragging] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const handleDragStart = (i) => (e) => {
    setDragging(i);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(i)); } catch { /* IE quirk */ }
    }
  };
  const handleDragOver = (i) => (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (i !== dragOver) setDragOver(i);
  };
  const handleDragEnd = () => { setDragging(null); setDragOver(null); };
  const handleDrop = (i) => (e) => {
    e.preventDefault();
    const from = dragging;
    setDragging(null); setDragOver(null);
    if (from == null || from === i) return;
    onReorderQueue?.(from, i);
  };

  // Hovered track for the tooltip strip below.
  const [hoverIndex, setHoverIndex] = useState(null);

  if (queue.length === 0) {
    return (
      <div style={{
        flex: 1, padding: '28px 18px', textAlign: 'center',
        color: 'rgba(255,255,255,0.5)', fontSize: 11.5, lineHeight: 1.6,
      }}>
        No tracks queued.
        <div style={{ marginTop: 6, fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
          Play something from the library and it'll show up here.
        </div>
      </div>
    );
  }

  // Sizing constants. ROW_HEIGHT picked to feel substantial without
  // dominating; PIXELS_PER_SECOND derived from container width and a
  // target of fitting roughly 8 minutes per row at default panel width
  // (containerWidth=320 → ~8min/row gives ~0.67px/s). Scales linearly
  // with width so wider panels show more queue per row.
  const ROW_HEIGHT = 56;
  const ROW_GAP = 6;
  const HORIZONTAL_PADDING = 8;
  const MIN_BLOCK_WIDTH = 28;
  const usableWidth = Math.max(120, containerWidth - HORIZONTAL_PADDING * 2);
  // Aim for ~8 minutes per row on a 320px panel; linearly scale.
  const pixelsPerSecond = usableWidth / (8 * 60);

  // Build row layout: pack blocks left-to-right, wrap when next would
  // overflow. Each entry carries its index, computed width, row, x-offset.
  const layout = [];
  let row = 0;
  let xCursor = 0;
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i];
    const sec = Math.max(15, t.duration || 180); // fall back to 3min if unknown
    let w = Math.max(MIN_BLOCK_WIDTH, Math.round(sec * pixelsPerSecond));
    // If a single track is wider than the entire row, cap it (otherwise
    // a 30-minute live track would push other blocks off-screen). Cap
    // at full row width minus a gap.
    if (w > usableWidth) w = usableWidth;
    // Wrap to next row if we'd overflow.
    if (xCursor + w > usableWidth && xCursor > 0) {
      row += 1;
      xCursor = 0;
    }
    layout.push({ index: i, track: t, x: xCursor, y: row * (ROW_HEIGHT + ROW_GAP), w });
    xCursor += w + 2; // 2px between blocks
  }
  const totalHeight = (row + 1) * (ROW_HEIGHT + ROW_GAP);

  const fmtTime = (sec) => {
    const s = Math.round(sec || 0);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  };

  const currentTrack = currentIndex >= 0 ? queue[currentIndex] : null;
  const currentDur = currentTrack?.duration || 0;
  const currentProgress = currentDur > 0 ? Math.min(1, Math.max(0, currentTime / currentDur)) : 0;

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
      overflow: 'hidden',
    }}>
      {/* Scrollable canvas */}
      <div
        ref={containerRef}
        style={{
          flex: 1, overflowY: 'auto', overflowX: 'hidden',
          padding: `8px ${HORIZONTAL_PADDING}px`,
          overscrollBehavior: 'contain',
          scrollbarGutter: 'stable',
        }}
      >
        <div style={{ position: 'relative', width: '100%', height: totalHeight }}>
          {layout.map(({ index: i, track: t, x, y, w }) => {
            const isCurrent = i === currentIndex;
            const isPlayed = i < currentIndex;
            const isHovered = hoverIndex === i;
            const isDropTarget = dragOver === i && dragging !== i && dragging != null;
            return (
              <div
                key={`${t.id}:${i}`}
                draggable
                onDragStart={handleDragStart(i)}
                onDragOver={handleDragOver(i)}
                onDragEnd={handleDragEnd}
                onDrop={handleDrop(i)}
                onClick={() => onJumpToQueueIndex?.(i)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!isCurrent) onRemoveFromQueue?.(i);
                }}
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex((cur) => (cur === i ? null : cur))}
                style={{
                  position: 'absolute',
                  left: x, top: y, width: w, height: ROW_HEIGHT,
                  borderRadius: 6,
                  background: isCurrent
                    ? `linear-gradient(135deg, rgba(${accent},0.45) 0%, rgba(${accent},0.25) 100%)`
                    : isPlayed
                    ? 'rgba(255,255,255,0.04)'
                    : 'rgba(255,255,255,0.08)',
                  border: isDropTarget
                    ? `2px solid rgba(${accent},0.85)`
                    : isCurrent
                    ? `1px solid rgba(${accent},0.6)`
                    : '1px solid rgba(255,255,255,0.06)',
                  boxShadow: isCurrent
                    ? `0 4px 16px rgba(${accent},0.35), inset 0 1px 0 rgba(255,255,255,0.08)`
                    : isHovered
                    ? '0 2px 8px rgba(0,0,0,0.3)'
                    : 'none',
                  opacity: isPlayed ? 0.5 : 1,
                  cursor: 'pointer',
                  // Transition on properties that won't cause layout reflow.
                  // Width/position are static once computed for this render.
                  transition: 'box-shadow 0.18s, border-color 0.18s, opacity 0.18s, background 0.18s',
                  overflow: 'hidden',
                  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                  padding: '6px 8px',
                  minWidth: 0,
                }}
              >
                {/* Title — sized down hard so even narrow blocks show
                   something readable. For very narrow blocks (< 50px),
                   the text gets ellipsized away naturally. */}
                <div style={{
                  fontSize: 9.5,
                  color: isCurrent ? '#fff' : isPlayed ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.85)',
                  fontWeight: isCurrent ? 700 : 500,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  lineHeight: 1.25,
                }}>
                  {t.title || 'Untitled'}
                </div>
                <div style={{
                  display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
                  gap: 4,
                }}>
                  <div style={{
                    fontSize: 8.5,
                    color: isCurrent ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.45)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    minWidth: 0, flex: 1,
                  }}>
                    {t.artist || ''}
                  </div>
                  <div style={{
                    fontSize: 8.5,
                    color: 'rgba(255,255,255,0.5)',
                    fontVariantNumeric: 'tabular-nums',
                    flexShrink: 0,
                  }}>
                    {fmtTime(t.duration || 0)}
                  </div>
                </div>

                {/* Real-time playhead — only on current track. A vertical
                   accent-tinted line drawn at currentTime/duration of the
                   block's width. Updates smoothly because currentTime
                   flows down from the audio element's timeupdate event. */}
                {isCurrent && currentDur > 0 ? (
                  <div style={{
                    position: 'absolute',
                    top: 0, bottom: 0,
                    left: `${currentProgress * 100}%`,
                    width: 2,
                    background: `rgba(${accent},0.95)`,
                    boxShadow: `0 0 8px rgba(${accent},0.8)`,
                    pointerEvents: 'none',
                  }} />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer hint — explains the controls without cluttering the
         visual. Stays subtle. */}
      <div style={{
        padding: '6px 10px',
        fontSize: 9.5, color: 'rgba(255,255,255,0.4)',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        textAlign: 'center',
      }}>
        click to jump · drag to reorder · right-click to remove
      </div>
    </div>
  );
}

export { QueueDrawer, QueueHandle, QueueTab, QueueViewToggleBtn, QueueViewToggle, QueuePainterView };
