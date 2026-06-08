import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';

function ContextMenu({ anchorX, anchorY, items, onClose, accent = '120, 90, 220' }) {
  const menuRef = useRef(null);
  const [position, setPosition] = useState({ left: anchorX, top: anchorY });
  const [openSubmenu, setOpenSubmenu] = useState(null); // index of open submenu item

  // Close on outside click and Esc
  useEffect(() => {
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    // mousedown so the click that opens another menu (which would also
    // immediately close this one) is handled in the right order.
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Edge-flip — measure the menu after mount and reposition if it'd overflow
  // the viewport. Done in a layout effect so the user never sees it offscreen.
  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const margin = 8;
    let left = anchorX;
    let top = anchorY;
    if (anchorX + rect.width + margin > vw) left = Math.max(margin, vw - rect.width - margin);
    if (anchorY + rect.height + margin > vh) top = Math.max(margin, anchorY - rect.height);
    setPosition({ left, top });
  }, [anchorX, anchorY]);

  return (
    <div
      ref={menuRef}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        zIndex: 200,
        minWidth: 184,
        padding: 5,
        borderRadius: 14,
        background: 'rgba(18,18,20,0.62)',
        backdropFilter: 'blur(30px) saturate(1.6)',
        WebkitBackdropFilter: 'blur(30px) saturate(1.6)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.07)',
        animation: 'imm-ctx-in 160ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <style>{`
        @keyframes imm-ctx-in {
          from { opacity: 0; transform: scale(0.96) translateY(-5px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
      {items.map((item, i) => {
        if (item.divider) {
          return <div key={`d-${i}`} style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 2px' }} />;
        }
        const isOpen = openSubmenu === i;
        return (
          <ContextMenuItem
            key={item.key || i}
            item={item}
            accent={accent}
            isSubmenuOpen={isOpen}
            onSubmenuOpen={() => setOpenSubmenu(i)}
            onSubmenuClose={() => setOpenSubmenu(null)}
            closeMenu={onClose}
            onAction={() => {
              if (item.disabled) return;
              if (!item.submenu) {
                item.onClick?.();
                onClose?.();
              }
            }}
          />
        );
      })}
    </div>
  );
}

/** Single row in the context menu. Splits out so submenu hover-state is local. */
function ContextMenuItem({ item, accent = '120, 90, 220', isSubmenuOpen, onSubmenuOpen, onSubmenuClose, onAction, closeMenu }) {
  const [hovered, setHovered] = useState(false);
  const itemRef = useRef(null);
  const submenuTimerRef = useRef(null);
  // The submenu needs to know the parent row's rect to position itself.
  // Reading `itemRef.current` directly inside the JSX is unreliable (the ref
  // may be null on the first render after isSubmenuOpen flips, and accessing
  // refs during render is a React anti-pattern). Instead we measure the rect
  // imperatively when the submenu becomes open, store it in state, and pass
  // it down. This guarantees the submenu always has a valid rect by the time
  // it mounts.
  const [submenuParentRect, setSubmenuParentRect] = useState(null);

  useLayoutEffect(() => {
    if (isSubmenuOpen && itemRef.current) {
      setSubmenuParentRect(itemRef.current.getBoundingClientRect());
    } else if (!isSubmenuOpen) {
      setSubmenuParentRect(null);
    }
  }, [isSubmenuOpen]);

  const handleMouseEnter = () => {
    setHovered(true);
    // Open submenu after a short delay (don't open on accidental pass-over)
    if (item.submenu && !isSubmenuOpen) {
      submenuTimerRef.current = setTimeout(() => {
        onSubmenuOpen?.();
      }, 180);
    }
  };
  const handleMouseLeave = () => {
    setHovered(false);
    if (submenuTimerRef.current) {
      clearTimeout(submenuTimerRef.current);
      submenuTimerRef.current = null;
    }
  };

  // Click handler. For leaf items: fire the action. For submenu items: also
  // toggle the submenu open immediately, in case the hover-delay path didn't
  // fire (e.g. user clicks the row before the 180ms timer elapses, or the
  // hover never registered for some reason).
  const handleClick = (e) => {
    e.stopPropagation();
    if (item.disabled) return;
    if (item.submenu) {
      // Cancel any pending hover-open timer so we don't double-fire.
      if (submenuTimerRef.current) {
        clearTimeout(submenuTimerRef.current);
        submenuTimerRef.current = null;
      }
      if (isSubmenuOpen) onSubmenuClose?.();
      else onSubmenuOpen?.();
      return;
    }
    onAction?.();
  };

  useEffect(() => () => {
    if (submenuTimerRef.current) clearTimeout(submenuTimerRef.current);
  }, []);

  // For the danger style, color the text red on hover.
  const baseColor = item.disabled ? 'rgba(255,255,255,0.3)' : (item.danger ? '#f37272' : 'rgba(255,255,255,0.92)');
  const hoverBg = item.disabled
    ? 'transparent'
    : (item.danger ? 'rgba(243, 114, 114, 0.12)' : `rgba(${accent}, 0.18)`);

  return (
    <div
      ref={itemRef}
      role="menuitem"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 11px',
        borderRadius: 9,
        color: baseColor,
        cursor: item.disabled ? 'default' : 'pointer',
        background: hovered ? hoverBg : 'transparent',
        fontSize: 12, fontWeight: 500,
        transition: 'background 0.12s cubic-bezier(0.16,1,0.3,1), color 0.12s',
        position: 'relative',
        userSelect: 'none',
      }}
    >
      {item.icon ? (
        <span style={{
          width: 14, height: 14, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'currentColor',
        }}>
          {item.icon}
        </span>
      ) : <span style={{ width: 14, flexShrink: 0 }} />}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.label}
      </span>
      {item.shortcut ? (
        <span style={{
          fontSize: 10, color: 'rgba(255,255,255,0.4)',
          fontVariantNumeric: 'tabular-nums', flexShrink: 0,
        }}>
          {item.shortcut}
        </span>
      ) : null}
      {item.submenu ? (
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', flexShrink: 0 }} aria-hidden>▶</span>
      ) : null}

      {/* Submenu — opens to the right by default. Only renders when this
          row's submenu state is open AND we have a measured parent rect.
          Auto-flips left if right-side would overflow. */}
      {item.submenu && isSubmenuOpen && submenuParentRect ? (
        <ContextSubmenu
          parentRect={submenuParentRect}
          items={item.submenu}
          onClose={onSubmenuClose}
          onAction={(subItem) => {
            if (subItem.disabled) return;
            // Fire the action FIRST so it doesn't get cancelled by the
            // unmount when we close the submenu / parent menu below.
            try { subItem.onClick?.(); } catch { /* ignore */ }
            onSubmenuClose?.();
            // Always bubble up to close the parent menu too. Previously
            // ContextMenu's own onAction short-circuited (via `if
            // (!item.submenu)`) when the parent had a submenu, leaving the
            // parent menu open after a submenu pick — confusing UX. Call
            // closeMenu directly so parent always closes on submenu action.
            closeMenu?.();
          }}
        />
      ) : null}
    </div>
  );
}

/** Submenu — same visual as ContextMenu but anchored to a parent row.
 *
 * Note: we intentionally do NOT close on `onMouseLeave` of the submenu
 * container alone. A user may briefly cross a 1-2px gap between the parent
 * row and submenu, or scroll a long playlist list — both should not dismiss
 * the menu. The parent menu's outside-click listener handles real dismissal.
 * Hover hand-off back to the parent row is handled by ContextMenuItem.
 */
function ContextSubmenu({ parentRect, items, onClose, onAction }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: parentRect.right + 4, top: parentRect.top - 4 });
  const [hoveredIdx, setHoveredIdx] = useState(null);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const margin = 8;
    let left = parentRect.right + 4;
    let top = parentRect.top - 4;
    if (left + rect.width + margin > vw) left = Math.max(margin, parentRect.left - rect.width - 4);
    if (top + rect.height + margin > vh) top = Math.max(margin, vh - rect.height - margin);
    setPos({ left, top });
  }, [parentRect]);

  return (
    <div
      ref={ref}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: pos.left, top: pos.top,
        minWidth: 180, maxHeight: 320, overflowY: 'auto',
        padding: 4,
        borderRadius: 9,
        background: 'rgba(20, 20, 22, 0.96)',
        backdropFilter: 'blur(28px) saturate(1.6)',
        WebkitBackdropFilter: 'blur(28px) saturate(1.6)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 20px 50px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)',
        animation: 'imm-ctx-in 120ms cubic-bezier(0.16, 1, 0.3, 1)',
        zIndex: 201,
        scrollbarWidth: 'thin',
      }}
    >
      {items.length === 0 ? (
        <div style={{
          padding: '8px 10px', fontSize: 10.5,
          color: 'rgba(255,255,255,0.4)', fontStyle: 'italic',
        }}>
          Empty
        </div>
      ) : items.map((sub, i) => {
        const isHov = hoveredIdx === i;
        const baseColor = sub.disabled ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.92)';
        return (
          <div
            key={sub.key || i}
            role="menuitem"
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
            onClick={() => onAction(sub)}
            style={{
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '6px 10px',
              borderRadius: 6,
              color: baseColor,
              cursor: sub.disabled ? 'default' : 'pointer',
              background: isHov && !sub.disabled ? 'rgba(255,255,255,0.07)' : 'transparent',
              fontSize: 11.5, fontWeight: 500,
              transition: 'background 0.1s',
              userSelect: 'none',
            }}
          >
            {sub.icon ? (
              <span style={{ width: 14, height: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {sub.icon}
              </span>
            ) : <span style={{ width: 14, flexShrink: 0 }} />}
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {sub.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}


/**
 * CandidatePickerModal — manual fallback when the tier matcher rejects
 * every candidate. Shown after a failed import; lets the user pick from up
 * to 12 surfaced YouTube videos (sorted by view count, highest first).
 *
 * The user sees thumbnail, title, channel, duration, view count for each.
 * Clicking one calls back to the importFromYoutubeId IPC which downloads
 * that specific video and writes it to library with the original metadata
 * (title/artist/album from Spotify, etc.) intact.
 */
function CandidatePickerModal({ open, candidates: initialCandidates, meta, onPick, onClose }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  // Local copy of candidates so we can replace them when the user refines
  // the search without bouncing back to the parent component.
  const [candidates, setCandidates] = useState(initialCandidates || []);
  // Refine-search field — pre-filled with the original "<artists> <title>"
  // string so the user can edit it (remove a "(remaster)" suffix, fix an
  // artist spelling, add "live", etc.) and re-search.
  const [searchInput, setSearchInput] = useState('');
  const [searching, setSearching] = useState(false);
  // URL paste field — accepts a YouTube URL/ID and downloads it directly.
  const [urlInput, setUrlInput] = useState('');
  const [urlBusy, setUrlBusy] = useState(false);

  // Reset state on open. Sync candidates from props and rebuild the
  // default search string from meta so the refine input shows what was
  // searched.
  useEffect(() => {
    if (open) {
      setBusyId(null);
      setError('');
      setUrlInput('');
      setUrlBusy(false);
      setCandidates(initialCandidates || []);
      const defaultQuery = `${meta?.artists || ''} ${meta?.title || ''}`.trim();
      setSearchInput(defaultQuery);
    }
  }, [open, meta?.artists, meta?.title, initialCandidates]);

  // Esc closes
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !busyId && !urlBusy) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busyId, urlBusy, onClose]);

  if (!open) return null;

  const fmtDuration = (s) => {
    if (!s) return '?';
    const mm = Math.floor(s / 60);
    const ss = Math.floor(s % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  };
  const fmtViews = (n) => {
    if (!n) return '';
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B views`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M views`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K views`;
    return `${n} views`;
  };

  // --- Match annotation -------------------------------------------------
  // Surface the same signals the auto-detector uses so a manual pick is an
  // informed one: how the candidate's length compares to Spotify's, what
  // kind of upload it is, and (when the track is explicit) whether it's a
  // clean cut we'd otherwise reject.
  const targetSec = Number(meta?.durationMs) > 0 ? Number(meta.durationMs) / 1000 : 0;
  const wantExplicit = meta?.explicit === true;
  const CLEAN_RE = /\(\s*clean\s*\)|\[\s*clean\s*\]|\bclean\s+(?:version|audio|lyrics?)\b|\bradio\s+(?:edit|version)\b|\bcensored\b|\bbleeped\b/i;

  const classify = (c) => {
    const title = String(c.title || '');
    const chan = String(c.channel || '');
    const isTopic = /\s-\s*topic\s*$/i.test(chan);
    const isLyric = /\blyrics?\b/i.test(title);
    const isVideo = /\bofficial\s*(?:music\s*)?video\b|\bmusic\s*video\b|\bm\/v\b|\(\s*video\s*\)/i.test(title);
    const isAudio = /\bofficial\s*audio\b|\bvisualizer\b|\baudio\b/i.test(title);
    let source = null;
    let rank = 2.5; // unlabelled uploads sort between lyric and video
    if (isTopic) { source = 'Topic'; rank = 0; }
    else if (isAudio) { source = 'Official Audio'; rank = 1; }
    else if (isLyric) { source = 'Lyrics'; rank = 2; }
    else if (isVideo) { source = 'Video'; rank = 3; }
    const dur = Number(c.duration) || 0;
    const delta = targetSec > 0 && dur > 0 ? dur - targetSec : null; // signed seconds
    const absDelta = delta == null ? null : Math.abs(delta);
    const isClean = wantExplicit && CLEAN_RE.test(title);
    return { source, rank, delta, absDelta, isClean };
  };

  // Colour + label for the duration-match chip.
  const matchColor = (absDelta) => {
    if (absDelta == null) return 'rgba(255,255,255,0.4)';
    if (absDelta <= 2) return '#5fd08a';   // green — same recording
    if (absDelta <= 5) return '#e3c15a';   // amber — close, probably fine
    return '#e57373';                       // red — wrong length / edit
  };
  const fmtDelta = (delta, absDelta) => {
    if (absDelta == null) return '';
    if (absDelta <= 1) return '✓ exact';
    const sign = delta > 0 ? '+' : '−';
    return `${sign}${Math.round(absDelta)}s`;
  };

  // Annotate + reorder by match quality (mirrors the detector): clean cuts of
  // an explicit track sink to the bottom, then source preference, then closest
  // duration, then view count. The top row is the detector's would-be pick.
  const annotated = (candidates || []).map((c) => ({ c, ...classify(c) }));
  annotated.sort((a, b) => {
    if (a.isClean !== b.isClean) return a.isClean ? 1 : -1;
    if (a.rank !== b.rank) return a.rank - b.rank;
    const ad = a.absDelta == null ? Infinity : a.absDelta;
    const bd = b.absDelta == null ? Infinity : b.absDelta;
    if (ad !== bd) return ad - bd;
    return (Number(b.c.viewCount) || 0) - (Number(a.c.viewCount) || 0);
  });

  // Small pill — matches the tinted tag style used elsewhere (the synced/plain
  // lyric tags): a plain inline span, tinted background, natural line-height so
  // the text sits centered exactly like those tags do.
  const Pill = ({ children, color, bg, border }) => (
    <span style={{
      padding: '3px 7px', borderRadius: 6, fontSize: 9, fontWeight: 700,
      letterSpacing: '0.05em', textTransform: 'uppercase',
      color: color || 'rgba(255,255,255,0.6)',
      background: bg || 'rgba(255,255,255,0.08)',
      border: border || '1px solid transparent',
      whiteSpace: 'nowrap',
    }}>{children}</span>
  );

  const handlePick = async (cand) => {
    setBusyId(cand.id);
    setError('');
    try {
      const result = await onPick?.(cand);
      if (!result?.ok) {
        setError(result?.error || 'Download failed.');
        setBusyId(null);
      }
      // On success, the parent closes the modal.
    } catch (e) {
      setError(String(e?.message || e));
      setBusyId(null);
    }
  };

  const handleRefineSearch = async () => {
    const q = searchInput.trim();
    if (!q || searching) return;
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.searchYoutubeCandidates) {
      setError('Search not available.');
      return;
    }
    setSearching(true);
    setError('');
    try {
      const r = await api.searchYoutubeCandidates({
        customQuery: q,
        // Belt-and-suspenders: also send the query as title/artists fallback
        // so older builds of main.js (where customQuery wasn't recognized
        // yet) don't error with "Missing title". Newer main.js prefers
        // customQuery and ignores these.
        title: q,
        artists: '',
      });
      if (r?.ok && Array.isArray(r.candidates)) {
        setCandidates(r.candidates);
        if (r.candidates.length === 0) {
          setError('No results for that search.');
        }
      } else {
        setError(r?.error || 'Search failed.');
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSearching(false);
    }
  };

  /**
   * Parse a YouTube URL or bare ID into an 11-character video ID.
   * Accepts:
   *   - https://www.youtube.com/watch?v=ID
   *   - https://youtu.be/ID
   *   - https://music.youtube.com/watch?v=ID
   *   - youtube.com/embed/ID
   *   - bare 11-char ID
   * Strips any extra query params (timestamps, playlists, etc).
   */
  const extractVideoId = (input) => {
    const s = String(input || '').trim();
    if (!s) return null;
    // Bare ID: 11 chars of [A-Za-z0-9_-]
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    // Try to extract from URL
    try {
      const url = new URL(s.startsWith('http') ? s : `https://${s}`);
      // Standard ?v=ID
      const v = url.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      // youtu.be/ID
      if (url.hostname.includes('youtu.be')) {
        const id = url.pathname.split('/').filter(Boolean)[0];
        if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return id;
      }
      // youtube.com/embed/ID or /shorts/ID
      const parts = url.pathname.split('/').filter(Boolean);
      const idx = parts.findIndex((p) => p === 'embed' || p === 'shorts' || p === 'v');
      if (idx >= 0 && parts[idx + 1] && /^[A-Za-z0-9_-]{11}$/.test(parts[idx + 1])) {
        return parts[idx + 1];
      }
    } catch {
      // Fall through — invalid URL
    }
    return null;
  };

  const handleUrlSubmit = async () => {
    const id = extractVideoId(urlInput);
    if (!id) {
      setError('Could not parse a YouTube URL or video ID from that.');
      return;
    }
    setUrlBusy(true);
    setError('');
    // Dispatch the same flow as picking from the list — onPick takes any
    // candidate-shaped object with at least an `id`.
    try {
      const result = await onPick?.({ id });
      if (!result?.ok) {
        setError(result?.error || 'Download failed.');
        setUrlBusy(false);
      }
      // On success, parent closes the modal.
    } catch (e) {
      setError(String(e?.message || e));
      setUrlBusy(false);
    }
  };

  const inputDisabled = !!busyId || !!urlBusy || searching;
  const accent = '120, 95, 220'; // soft purple — matches existing modal accents

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busyId && !urlBusy) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}>
      <div style={{
        width: 'min(620px, 96vw)', maxHeight: '88vh',
        background: 'rgba(18,18,20,0.62)',
        backdropFilter: 'blur(30px) saturate(1.6)',
        WebkitBackdropFilter: 'blur(30px) saturate(1.6)',
        border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16,
        boxShadow: '0 24px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.07)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
            Pick a video to import
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 4, lineHeight: 1.45 }}>
            Importing{' '}
            <span style={{ color: 'rgba(255,255,255,0.85)' }}>
              {meta?.artists ? `${meta.artists} — ` : ''}{meta?.title}
            </span>.
            Tweak the search below to refine results, or paste a YouTube URL at the bottom.
          </div>
        </div>

        {/* Refine search */}
        <div style={{
          padding: '10px 18px', borderBottom: '1px solid rgba(255,255,255,0.04)',
          display: 'flex', gap: 6, alignItems: 'center',
        }}>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRefineSearch(); }}
            disabled={inputDisabled}
            placeholder="Refine search…"
            style={{
              flex: 1, padding: '7px 11px', borderRadius: 8,
              background: 'rgba(0,0,0,0.35)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#fff', fontSize: 11.5, outline: 'none',
              transition: 'border-color 0.15s, background 0.15s',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = `rgba(${accent}, 0.4)`; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
          />
          <button
            type="button"
            onClick={handleRefineSearch}
            disabled={inputDisabled || !searchInput.trim()}
            style={{
              padding: '7px 14px', borderRadius: 8, border: 'none',
              background: searching ? 'rgba(255,255,255,0.06)' : `rgba(${accent}, 0.4)`,
              color: '#fff', fontSize: 11, fontWeight: 700,
              cursor: (inputDisabled || !searchInput.trim()) ? 'default' : 'pointer',
              opacity: (inputDisabled || !searchInput.trim()) ? 0.5 : 1,
              flexShrink: 0,
              transition: 'background 0.15s, opacity 0.15s',
            }}
          >
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>

        {/* Candidate list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {searching ? (
            <div style={{ padding: '32px 18px', textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: 11.5 }}>
              Searching YouTube…
            </div>
          ) : (annotated && annotated.length > 0) ? (
            annotated.map(({ c, source, delta, absDelta, isClean }, idx) => {
            const isBusy = busyId === c.id;
            const isOtherBusy = (busyId && busyId !== c.id) || urlBusy;
            // The first non-clean row is the detector's would-be pick.
            const isBest = idx === 0 && !isClean;
            const accentBar = isBest ? 'rgba(95,208,138,0.55)' : isClean ? 'rgba(229,115,115,0.5)' : 'transparent';
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => handlePick(c)}
                disabled={!!busyId || !!urlBusy}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  width: '100%', padding: '10px 18px 10px 15px',
                  background: isBusy ? 'rgba(120, 95, 220, 0.12)' : 'transparent',
                  border: 'none', borderBottom: '1px solid rgba(255,255,255,0.04)',
                  borderLeft: `3px solid ${accentBar}`,
                  color: '#fff', textAlign: 'left',
                  cursor: (busyId || urlBusy) ? 'default' : 'pointer',
                  opacity: isOtherBusy ? 0.4 : isClean ? 0.72 : 1,
                  transition: 'background 0.15s, opacity 0.15s',
                }}
                onMouseEnter={(e) => { if (!busyId && !urlBusy) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={(e) => { if (!busyId && !urlBusy) e.currentTarget.style.background = isBusy ? 'rgba(120, 95, 220, 0.12)' : 'transparent'; }}
              >
                {/* Thumbnail */}
                <div style={{
                  width: 96, height: 54, flexShrink: 0,
                  background: 'rgba(0,0,0,0.4)', borderRadius: 6, overflow: 'hidden',
                  position: 'relative',
                }}>
                  {c.thumbnailUrl ? (
                    <img
                      src={c.thumbnailUrl}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : null}
                  {/* Duration overlay — tinted by how well it matches Spotify. */}
                  <div style={{
                    position: 'absolute', bottom: 3, right: 3,
                    background: 'rgba(0,0,0,0.85)', color: matchColor(absDelta),
                    fontSize: 9, padding: '1px 4px', borderRadius: 3,
                    fontWeight: 700,
                  }}>
                    {fmtDuration(c.duration)}
                  </div>
                </div>
                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, fontWeight: 600, color: '#fff',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    marginBottom: 3,
                  }}>
                    {c.title}
                  </div>
                  {/* Badge row — source, duration-match, best, clean warning. */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 3 }}>
                    {isBest ? (
                      <Pill color="#fff" bg="rgba(95,208,138,0.22)" border="1px solid rgba(95,208,138,0.38)">Best match</Pill>
                    ) : null}
                    {source ? (
                      <Pill
                        color={source === 'Topic' ? '#cdddff' : 'rgba(255,255,255,0.6)'}
                        bg={source === 'Topic' ? 'rgba(120,150,255,0.18)' : 'rgba(255,255,255,0.08)'}
                      >{source}</Pill>
                    ) : null}
                    {absDelta != null ? (
                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.03em', color: matchColor(absDelta), whiteSpace: 'nowrap' }}>
                        {fmtDelta(delta, absDelta)}
                      </span>
                    ) : null}
                    {isClean ? (
                      <Pill color="#ffb3b3" bg="rgba(229,115,115,0.18)" border="1px solid rgba(229,115,115,0.4)">Clean</Pill>
                    ) : null}
                  </div>
                  <div style={{
                    fontSize: 10.5, color: 'rgba(255,255,255,0.55)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {c.channel}{c.viewCount ? ` · ${fmtViews(c.viewCount)}` : ''}
                  </div>
                </div>
                {isBusy ? (
                  <div style={{ flexShrink: 0, fontSize: 11, color: 'rgba(155,130,240,0.95)', fontWeight: 600 }}>
                    Downloading…
                  </div>
                ) : null}
              </button>
            );
          })
        ) : (
          <div style={{ padding: '32px 18px', textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 11.5, lineHeight: 1.5 }}>
            No candidates.
            <br />
            <span style={{ color: 'rgba(255,255,255,0.35)' }}>Try refining the search above, or paste a URL below.</span>
          </div>
        )}
        </div>

        {/* URL paste — last resort when YouTube search just won't surface
            what the user wants. They go to YouTube manually, find the
            video, paste the URL/ID here, we download that exact video. */}
        <div style={{
          padding: '10px 18px',
          borderTop: '1px solid rgba(255,255,255,0.04)',
          background: 'rgba(0,0,0,0.18)',
          display: 'flex', gap: 6, alignItems: 'center',
        }}>
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleUrlSubmit(); }}
            disabled={inputDisabled}
            placeholder="…or paste a YouTube URL"
            style={{
              flex: 1, padding: '7px 11px', borderRadius: 8,
              background: 'rgba(0,0,0,0.35)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#fff', fontSize: 11.5, outline: 'none',
              transition: 'border-color 0.15s, background 0.15s',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = `rgba(${accent}, 0.4)`; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
          />
          <button
            type="button"
            onClick={handleUrlSubmit}
            disabled={inputDisabled || !urlInput.trim()}
            style={{
              padding: '7px 14px', borderRadius: 8, border: 'none',
              background: urlBusy ? 'rgba(255,255,255,0.06)' : `rgba(${accent}, 0.4)`,
              color: '#fff', fontSize: 11, fontWeight: 700,
              cursor: (inputDisabled || !urlInput.trim()) ? 'default' : 'pointer',
              opacity: (inputDisabled || !urlInput.trim()) ? 0.5 : 1,
              flexShrink: 0,
              transition: 'background 0.15s, opacity 0.15s',
            }}
          >
            {urlBusy ? 'Importing…' : 'Import URL'}
          </button>
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 18px 14px', borderTop: '1px solid rgba(255,255,255,0.04)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          {error ? (
            <div style={{ fontSize: 10.5, color: '#f37272', flex: 1, lineHeight: 1.45 }}>
              {error}
            </div>
          ) : <div />}
          <button type="button" onClick={onClose} disabled={inputDisabled}
            style={{
              padding: '7px 14px', borderRadius: 8, border: 'none',
              background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)',
              fontSize: 11, fontWeight: 600, cursor: inputDisabled ? 'default' : 'pointer',
              flexShrink: 0,
            }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}


export { ContextMenu, ContextMenuItem, ContextSubmenu, CandidatePickerModal };
