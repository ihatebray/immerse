import React, { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import Icons from './Icons.jsx';
import { Tooltip } from './sharedUI.jsx';
import { PlaylistThumb } from './PlaylistEditor.jsx';
import { FindTab } from './FindTab.jsx';
import { LibraryTab } from './LibraryTab.jsx';
import { NewReleasesTab } from './NewReleasesTab.jsx';
import { SettingsTab } from './SettingsTab.jsx';
import { StatsTab } from './StatsTab.jsx';
import { QueueTab } from './Queue.jsx';
import { TrackTab } from './TrackTab.jsx';
import { PlaylistView } from './PlaylistView.jsx';

function NavRail({
  side = 'right',
  tab,
  onTabChange,
  panelOpen,
  onTogglePanel,
  libraryCount,
  accent = '48, 48, 48',
  // Pinnable-tabs props — if undefined, the feature is treated as off.
  pinnableTabsEnabled = false,
  hiddenTabIds = [],
  tabContextHandler = () => undefined,
}) {
  const handleTabClick = (id) => {
    if (tab === id && panelOpen) {
      // Click the active tab while panel is open → close panel.
      onTogglePanel();
      return;
    }
    onTabChange(id);
    if (!panelOpen) onTogglePanel();
  };

  return (
    <aside
      style={{
        position: 'absolute',
        top: 44, bottom: 12,
        ...(side === 'right' ? { right: 12 } : { left: 12 }),
        width: 40,
        zIndex: 6, // above the panel so it always catches clicks
        display: 'flex', flexDirection: 'column',
        alignItems: 'center',
        padding: '8px 0',
        borderRadius: 14,
        background: 'rgba(18,18,20,0.62)',
        backdropFilter: 'blur(30px) saturate(1.6)',
        WebkitBackdropFilter: 'blur(30px) saturate(1.6)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.07)',
        WebkitAppRegion: 'no-drag',
      }}
    >
      {/* Panel toggle — chevron pointing inward when closed, outward when open */}
      <button
        type="button"
        onClick={onTogglePanel}
        title={panelOpen ? 'Hide panel' : 'Show panel'}
        aria-label={panelOpen ? 'Hide panel' : 'Show panel'}
        style={{
          width: 28, height: 24, borderRadius: 6, marginBottom: 8,
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
          color: 'rgba(255,255,255,0.55)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          transition: 'color 0.15s, background 0.15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.85)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; }}
      >
        <svg
          width="10" height="10" viewBox="0 0 24 24"
          // Chevron points toward the screen interior when closed (so user
          // sees "open this way") and toward the rail when open ("close").
          style={{
            transform: side === 'right'
              ? `rotate(${panelOpen ? 0 : 180}deg)`
              : `rotate(${panelOpen ? 180 : 0}deg)`,
            transition: 'transform 0.2s',
          }}
          fill="currentColor" aria-hidden
        >
          <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
        </svg>
      </button>

      <div style={{ height: 1, width: 22, background: 'rgba(255,255,255,0.06)', marginBottom: 8 }} />

      {/* Tab icons — order matches the dock: Find, Library, New, Settings.
          When pinnable-tabs is enabled, hidden tabs render nothing and the
          remaining tabs accept right-click for a hide action. Library and
          Settings are protected (always visible). */}
      {!(pinnableTabsEnabled && hiddenTabIds.includes('find')) ? (
        <NavRailIcon active={tab === 'find' && panelOpen} onClick={() => handleTabClick('find')} title="Find" onContextMenu={tabContextHandler('find')} tutorialId="dock-find">
          <Icons.Search />
        </NavRailIcon>
      ) : null}
      <NavRailIcon active={tab === 'library' && panelOpen} onClick={() => handleTabClick('library')} title={`Library · ${libraryCount}`} tutorialId="dock-library">
        <Icons.LibrarySidebar />
      </NavRailIcon>
      {!(pinnableTabsEnabled && hiddenTabIds.includes('new')) ? (
        <NavRailIcon active={tab === 'new' && panelOpen} onClick={() => handleTabClick('new')} title="Explore" onContextMenu={tabContextHandler('new')} tutorialId="dock-new">
          <Icons.NewReleases />
        </NavRailIcon>
      ) : null}
      <NavRailIcon active={tab === 'settings' && panelOpen} onClick={() => handleTabClick('settings')} title="Settings" tutorialId="dock-settings">
        <Icons.Settings />
      </NavRailIcon>
    </aside>
  );
}

/**
 * NavRailIcon — a single button in the rail. Slightly larger than the old
 * RailIcon, with a clearer active state (accent-tinted background + left
 * inset bar to emphasize "active tab").
 */
function NavRailIcon({ active, onClick, title, children, onContextMenu, tutorialId }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title}
      aria-label={title}
      data-tutorial-target={tutorialId}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 28, height: 28, borderRadius: 8, marginBottom: 4,
        background: active
          ? 'rgba(255,255,255,0.14)'
          : (hovered ? 'rgba(255,255,255,0.06)' : 'transparent'),
        border: 'none',
        color: active ? '#fff' : (hovered ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.55)'),
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
        flexShrink: 0,
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      {children}
    </button>
  );
}


/**
 * BottomDockBar — centered floating pill at the bottom of the window.
 *
 * Holds the four primary tab icons (Find / Library / New / Settings) plus
 * a queue button on the far right. Replaces the side NavRail (which
 * permanently occupied a screen edge) and the QueueHandle (a separate
 * pull-tab that lived in the same bottom-center region anyway). One
 * unified piece of UI instead of two.
 *
 * Behavior:
 *   - Tap a tab icon while panel is closed → opens panel on that tab
 *   - Tap a different tab icon while panel is open → switches tab
 *   - Tap the active tab while panel is open → closes the panel
 *   - Tap queue icon → opens the queue drawer (independent of panel state)
 *
 * Positioning: bottom-center, sits 16px above the window edge. The bar
 * itself doesn't take side margin so it can be quite wide if needed.
 */
function BottomDockBar({
  tab,
  onTabChange,
  panelOpen,
  onTogglePanel,
  libraryCount,
  queueCount = 0,
  // Lyrics toggle — replaces the previous queue button. The queue is now
  // a tab inside the side dock panel, accessed via a tab button alongside
  // the other navigation tabs.
  lyricsVisible = false,
  onToggleLyrics,
  lyricsAvailable = false,
  accent = '48, 48, 48',
  // Pinnable-tabs feature — when enabled, hidden tabs disappear from the
  // bar entirely. Right-click on a hideable tab fires the supplied
  // `tabContextHandler`, which opens the local hide-popover in SideDock.
  pinnableTabsEnabled = false,
  hiddenTabIds = [],
  dockOrder = [],
  onSetDockOrder,
  tabContextHandler = () => undefined,
  // Random play — when enabled, a dice icon appears in the bar that plays
  // a uniformly-random track from the library. Sits at the right end of
  // the dock, just before the lyrics button.
  randomButtonEnabled = false,
  onPlayRandom,
  // Breathing dock pill — when enabled and music is playing, the dock's
  // accent ring + outer glow pulse subtly on an 8s loop, matching the
  // cover's breathing rhythm. Pure visual ambience.
  breathingDockPillEnabled = false,
  // Transparent dock — when enabled, the pill's solid dark backdrop drops
  // away so the cover-art-derived background bleeds through. Falls back
  // to the standard semi-opaque fill when off.
  dockTransparentEnabled = false,
  // Liquid glass dock — opt-in beyond plain transparency. Layers a
  // multi-step frosted-glass effect (heavy blur, top-edge highlight,
  // specular sheen, accent inner glow) so the dock reads as a slab
  // of real glass laid over the cover art rather than just a faded fill.
  liquidGlassDockEnabled = false,
  // Listening Journal — when enabled, a Journal button appears in the
  // tab row between Stats and the divider. The actual tab content is
  // rendered by SideDock; this just controls whether the icon shows.
  journalTabEnabled = false,
  // Recently-played peek — when enabled, a clock icon appears in the
  // dock; clicking pops a small panel listing recently-played tracks.
  // The popover is owned here (not in SideDock) because it should
  // anchor to the button and appear without opening the side panel.
  // Library + play events feed the peek's "recently played" list. We
  // pass them through directly so the peek doesn't need a separate IPC.
  library = [],
  playEvents = [],
  onPlayTrack,
  isPlaying = false,
  // Dock drag — when enabled, the user can pick up the dock and move it
  // anywhere on screen. Position persists until the feature is disabled.
  dockDraggableEnabled = false,
  dockPosition = null,
  onSetDockPosition,
  // Pinned playlists — user-chosen playlists shown as dock buttons
  pinnedPlaylists = [],
  onTogglePinnedPlaylist,
  playlists = [],
  playlistCoverMap = new Map(),
}) {
  const handleTabClick = (id) => {
    if (tab === id && panelOpen) {
      onTogglePanel();
      return;
    }
    onTabChange(id);
    if (!panelOpen) onTogglePanel();
  };

  // Whether the breathing animation should be running right now.
  const breathing = breathingDockPillEnabled && isPlaying;

  // Stable random phase for the liquid-glass specular sheen. We pick
  // once via useRef so parent re-renders don't reset the animation —
  // otherwise the sheen would jump every time a sibling state changes.
  const sheenPhaseRef = useRef(`-${Math.floor(Math.random() * 3)}s`);

  // Recently-played peek state. The button sits in the dock; clicking
  // toggles the popover. The button ref lets the popover anchor itself
  // to the button's screen position so it sits just above the dock.
  // Close when clicking anywhere outside the peek button or popover.
  // We can't use a simple onClick on a backdrop because the popover
  // floats above the dock without one — instead we attach a document
  // listener while open. Ignores clicks that originated inside the
  // peek itself (the popover has its own data attribute marker).


  // --- Dock drag handling ------------------------------------------------
  // When `dockDraggableEnabled` is true, mousedown on the dock body (NOT on
  // a button or interactive child) starts a drag. Drag updates the
  // `dockPosition` so the dock follows the cursor; release commits.
  // The mouse offset within the dock at drag-start is captured so the
  // drop point lines up with the click point (otherwise the dock would
  // jump to top-left of the cursor).
  const dragStateRef = useRef(null);
  const onDockMouseDown = (e) => {
    if (!dockDraggableEnabled) return;
    if (e.button !== 0) return;
    // Only initiate drag when the user grabs the dock body itself, not a
    // button or icon inside. Walk up from the target; if we hit a button
    // before hitting the container we registered on, abort.
    let el = e.target;
    while (el && el !== e.currentTarget) {
      if (el.tagName === 'BUTTON' || el.getAttribute?.('role') === 'button') return;
      el = el.parentElement;
    }
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    dragStateRef.current = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    const onMove = (ev) => {
      if (!dragStateRef.current) return;
      const { offsetX, offsetY, width, height } = dragStateRef.current;
      // Keep the dock fully on-screen — cap at 0..(viewport - size).
      const maxX = window.innerWidth - width;
      const maxY = window.innerHeight - height;
      const x = Math.max(0, Math.min(maxX, ev.clientX - offsetX));
      const y = Math.max(0, Math.min(maxY, ev.clientY - offsetY));
      onSetDockPosition?.({ xFromLeft: x, yFromTop: y });
    };
    const onUp = () => {
      dragStateRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Compute positioning. Default: bottom-center via translateX. Custom:
  // absolute left/top from dockPosition; no transform.
  const usingCustomPosition = dockDraggableEnabled && dockPosition !== null;
  const positionStyle = usingCustomPosition
    ? {
        left: dockPosition.xFromLeft,
        top: dockPosition.yFromTop,
        transform: 'none',
      }
    : {
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
      };

  // Resolve the three possible dock surface modes into a single style
  // object. The modes are mutually-composable in principle (liquid glass
  // can layer over transparent), but in practice liquid glass supplies
  // its own base fill since the whole point is the multi-layer optical
  // illusion. Branch order: liquid > transparent > solid.
  let surfaceStyle;
  if (liquidGlassDockEnabled) {
    // Liquid glass — three stacked layers in a single background, plus
    // a richer backdrop-filter stack and a deeper box-shadow stack.
    // Layer 1 (top): faint top-edge light catch — the "highlight" you
    //   see on the top edge of real polished glass.
    // Layer 2 (middle): soft accent-tinted radial glow from below
    //   center, so the dock picks up some of the track's color cast.
    // Layer 3 (bottom): the dark base fill, kept lower-opacity so the
    //   cover wash still bleeds through but the icons stay legible.
    // The brightness(1.05) inside backdrop-filter is what separates
    // "glass" from "frosted plastic" — it brightens the bled-through
    // colors a hair so the surface reads as light-transmitting.
    surfaceStyle = {
      background: `
        linear-gradient(180deg,
          rgba(255,255,255,0.16) 0%,
          rgba(255,255,255,0.04) 18%,
          rgba(255,255,255,0)    35%,
          rgba(0,0,0,0.05)       100%),
        radial-gradient(ellipse 80% 60% at 50% 110%,
          rgba(${accent}, 0.22) 0%,
          rgba(${accent}, 0)    70%),
        rgba(18, 18, 20, 0.32)
      `,
      backdropFilter: 'blur(50px) saturate(2) brightness(1.05)',
      WebkitBackdropFilter: 'blur(50px) saturate(2) brightness(1.05)',
      // Glass-style border: subtle on most edges, brighter on top to
      // catch the implied light source. The four-layer box-shadow is
      // doing the heavy optical lifting: outer drop, accent rim glow,
      // top-edge inner highlight, bottom-edge inner shadow line.
      border: '1px solid rgba(255,255,255,0.12)',
      boxShadow: breathing ? undefined : `
        0 20px 50px rgba(0,0,0,0.55),
        0 0 0 1px rgba(${accent}, 0.18),
        0 0 24px rgba(${accent}, 0.1),
        inset 0 1px 0 rgba(255,255,255,0.22),
        inset 0 -1px 0 rgba(0,0,0,0.25)
      `,
    };
  } else if (dockTransparentEnabled) {
    // Transparent — the original "let the wash through" mode. Thin
    // fill, stronger blur to soften any cover detail into a wash.
    surfaceStyle = {
      background: 'rgba(18,18,20,0.18)',
      backdropFilter: 'blur(30px) saturate(1.6)',
      WebkitBackdropFilter: 'blur(30px) saturate(1.6)',
      border: '1px solid rgba(255,255,255,0.1)',
      boxShadow: breathing ? undefined : `
        0 24px 60px rgba(0,0,0,0.6),
        inset 0 1px 0 rgba(255,255,255,0.07)
      `,
    };
  } else {
    // Solid — the default. Matches the metadata/playlist editor glass.
    surfaceStyle = {
      background: 'rgba(18,18,20,0.62)',
      backdropFilter: 'blur(30px) saturate(1.6)',
      WebkitBackdropFilter: 'blur(30px) saturate(1.6)',
      border: '1px solid rgba(255,255,255,0.1)',
      boxShadow: breathing ? undefined : `
        0 24px 60px rgba(0,0,0,0.6),
        inset 0 1px 0 rgba(255,255,255,0.07)
      `,
    };
  }

  return (
    <div
      onMouseDown={onDockMouseDown}
      style={{
        position: 'absolute',
        ...positionStyle,
        zIndex: 6,
        display: 'flex', alignItems: 'center',
        padding: '6px 10px',
        gap: 4,
        borderRadius: 14,
        ...surfaceStyle,
        // CSS custom properties so the keyframes can reference the live
        // accent without us having to inject a per-track keyframe. The
        // browser interpolates the shadow stack on each frame using these
        // values, so accent shifts on track change pick up automatically.
        ['--imm-dock-accent']: accent,
        animation: breathing ? 'immerseDockBreathe 8s ease-in-out infinite' : 'none',
        // Cursor: grab when draggable so the user gets affordance feedback.
        cursor: dockDraggableEnabled ? 'grab' : 'default',
        WebkitAppRegion: 'no-drag',
      }}
    >
      <style>{`
        @keyframes immerseDockBreathe {
          0%, 100% {
            box-shadow:
              0 16px 40px rgba(0,0,0,0.5),
              0 0 0 1px rgba(var(--imm-dock-accent), 0.1),
              0 0 0 0 rgba(var(--imm-dock-accent), 0),
              inset 0 1px 0 rgba(255,255,255,0.05);
          }
          50% {
            box-shadow:
              0 16px 40px rgba(0,0,0,0.5),
              0 0 0 1px rgba(var(--imm-dock-accent), 0.35),
              0 0 28px 4px rgba(var(--imm-dock-accent), 0.18),
              inset 0 1px 0 rgba(255,255,255,0.08);
          }
        }
        /* Specular sheen — a thin diagonal highlight that slowly drifts
           across the dock. This is what separates "frosted plastic" from
           "polished glass": real glass has a moving spec from any light
           source. We use a single-pass animation over ~9s with a long
           pause off-screen so the sheen feels occasional, not constant. */
        @keyframes immerseDockSheen {
          0%   { transform: translateX(-140%) skewX(-20deg); opacity: 0; }
          8%   { opacity: 0.55; }
          22%  { transform: translateX(140%) skewX(-20deg); opacity: 0; }
          100% { transform: translateX(140%) skewX(-20deg); opacity: 0; }
        }
      `}</style>
      {liquidGlassDockEnabled ? (
        /* Specular sheen overlay — only present in liquid-glass mode.
           Absolutely positioned across the dock surface with pointer
           events disabled so it never blocks button clicks. The
           overflow:hidden on this wrapper keeps the angled sheen from
           bleeding past the dock's rounded corners. */
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: 0,
            borderRadius: 14,
            overflow: 'hidden',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: '-20%', bottom: '-20%',
              left: 0,
              width: '40%',
              background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.55) 50%, transparent 100%)',
              filter: 'blur(8px)',
              // Overlay blend so the sheen reads as a light catch on the
              // glass rather than painting over the buttons. Where the
              // sheen overlaps an icon, the icon gets brighter; where
              // it's over empty glass, the glass picks up the highlight.
              // This also conveniently sidesteps any z-stacking issues
              // with the dock buttons.
              mixBlendMode: 'overlay',
              animation: 'immerseDockSheen 9s ease-in-out infinite',
              animationDelay: sheenPhaseRef.current,
            }}
          />
        </div>
      ) : null}
      {(() => {
        // Reorderable nav buttons. `library` and `settings` are pinned and
        // not reorderable; the rest follow the persisted dockOrder. Right-click
        // → Move left/right rewrites dockOrder.
        const DEFAULT_ORDER = ['find', 'library', 'new', 'settings', 'stats', 'journal'];
        const defs = {
          find:     { title: 'Find',          icon: <Icons.Search />,       hideable: true,  onCtx: true },
          library:  { title: `Library · ${libraryCount}`, icon: <Icons.LibrarySidebar />, onCtx: true },
          new:      { title: 'Explore',        icon: <Icons.NewReleases />,  hideable: true,  onCtx: true },
          settings: { title: 'Settings',       icon: <Icons.Settings />,     onCtx: true },
          stats:    { title: 'Listening stats', icon: <Icons.Stats />,       hideable: true,  onCtx: true },
          journal:  { title: 'Listening journal', icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2 5c3 0 7 1 10 2 3-1 7-2 10-2v14c-3 0-7 1-10 2-3-1-7-2-10-2V5z" />
              <line x1="12" y1="7" x2="12" y2="21" />
            </svg>
          ), hideable: true, onCtx: true, gated: 'journal' },
        };
        // Merge saved order with defaults so unknown/missing IDs are handled.
        const saved = Array.isArray(dockOrder) ? dockOrder.filter((id) => defs[id]) : [];
        const ordered = [...saved];
        for (const id of DEFAULT_ORDER) if (!ordered.includes(id)) ordered.push(id);
        return ordered.map((id) => {
          const d = defs[id];
          if (!d) return null;
          if (id === 'journal' && !journalTabEnabled) return null;
          if (d.hideable && pinnableTabsEnabled && hiddenTabIds.includes(id)) return null;
          return (
            <BottomDockBtn key={id}
              active={tab === id && panelOpen}
              onClick={() => handleTabClick(id)}
              title={d.title}
              onContextMenu={d.onCtx ? tabContextHandler(id) : undefined}
              tutorialId={`dock-${id}`}>
              {d.icon}
            </BottomDockBtn>
          );
        });
      })()}

      {/* Pinned playlists — user-chosen playlists that show as dock buttons.
          Each shows a tiny PlaylistThumb as its icon. */}
      {pinnedPlaylists && pinnedPlaylists.length > 0 ? (
        <>
          <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.08)', margin: '0 2px' }} />
          {pinnedPlaylists.map((plId) => {
            const pl = playlists?.find((p) => p.id === plId);
            if (!pl) return null;
            const isActive = tab === `playlist:${pl.id}` && panelOpen;
            return (
              <BottomDockBtn key={`pinned-${pl.id}`}
                active={isActive}
                onClick={() => handleTabClick(`playlist:${pl.id}`)}
                title={pl.name || 'Playlist'}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (onTogglePinnedPlaylist) onTogglePinnedPlaylist(pl.id);
                }}
                accent={accent}>
                <PlaylistThumb playlist={pl} trackCovers={playlistCoverMap?.get(pl.id) || []} size={18} />
              </BottomDockBtn>
            );
          })}
        </>
      ) : null}

      {/* Divider — separates the navigation tabs (Find/Library/New/Settings)
          from the playback-context buttons (Queue/Lyrics). */}
      <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.08)', margin: '0 4px' }} />

      {/* Track tab — opens the side dock panel on the Track tab, which shows
          info about whatever's currently playing: hero strip, your history
          with this track, more from the album, more from the artist.
          Belongs in the playback-context group because it's all about
          what's happening right now. Hideable via pinnable-tabs. */}
      {!(pinnableTabsEnabled && hiddenTabIds.includes('track')) ? (
        <BottomDockBtn
          active={tab === 'track' && panelOpen}
          onClick={() => handleTabClick('track')}
          onContextMenu={tabContextHandler('track')}
          title="About this track"
          accent={accent}
          tutorialId="dock-track"
        >
          {/* "Info" glyph — circle with an i. Universally recognised; pairs
              cleanly with the bar-chart Stats icon and the dice Random
              icon nearby without clashing. */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <line x1="12" y1="11" x2="12" y2="16.5" />
            <circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" />
          </svg>
        </BottomDockBtn>
      ) : null}

      {/* Random play — when enabled, plays a uniformly-random track from the
          library on click. Decision-fatigue cure. Lives in the playback-
          context group because it's an action that affects what's playing
          right now. Disabled (visually muted) if the library is empty. */}
      {randomButtonEnabled && typeof onPlayRandom === 'function' ? (
        <BottomDockBtn
          active={false}
          onClick={() => onPlayRandom?.()}
          title="Play something random"
          accent={accent}
        >
          {/* Dice — five-pip face. Rounded square outline + pips. Universal
              "random" symbol that won't be confused with shuffle (which uses
              the crossed-arrows icon elsewhere). */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="3" width="18" height="18" rx="3" ry="3" />
            <circle cx="8"  cy="8"  r="1.1" fill="currentColor" stroke="none" />
            <circle cx="16" cy="8"  r="1.1" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="8"  cy="16" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="16" cy="16" r="1.1" fill="currentColor" stroke="none" />
          </svg>
        </BottomDockBtn>
      ) : null}


      {/* Queue tab — opens the side dock panel on the queue tab. Count
          badge surfaces how many tracks are queued so the user knows
          there's something there without needing to open it. */}
      {!(pinnableTabsEnabled && hiddenTabIds.includes('queue')) ? (
        <BottomDockBtn
          active={tab === 'queue' && panelOpen}
          onClick={() => handleTabClick('queue')}
          onContextMenu={tabContextHandler('queue')}
          title={queueCount > 0 ? `Queue · ${queueCount}` : 'Queue'}
          badge={queueCount > 0 ? queueCount : null}
          accent={accent}
          tutorialId="dock-queue"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <circle cx="3.5" cy="6" r="1.2" fill="currentColor" />
            <circle cx="3.5" cy="12" r="1.2" fill="currentColor" />
            <circle cx="3.5" cy="18" r="1.2" fill="currentColor" />
          </svg>
        </BottomDockBtn>
      ) : null}

      {/* Lyrics view-toggle. Disabled (visually muted) when no track is
          playing or no lyrics are available. Speech-bubble icon with
          interior text-lines reads instantly as "the words being said in
          this track" — distinct from the queue's straight lines because
          it has a recognizable container shape (rounded rectangle with
          a tail). */}
      {!(pinnableTabsEnabled && hiddenTabIds.includes('lyrics')) ? (
        <BottomDockBtn
          active={lyricsVisible && lyricsAvailable}
          onClick={onToggleLyrics}
          onContextMenu={tabContextHandler('lyrics')}
          title={lyricsVisible ? 'Hide lyrics' : 'Show lyrics'}
          accent={accent}
          disabled={!lyricsAvailable}
          tutorialId="dock-lyrics"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {/* Rounded speech-bubble outline with a small tail */}
            <path d="M4 5 a 2 2 0 0 1 2 -2 h 12 a 2 2 0 0 1 2 2 v 9 a 2 2 0 0 1 -2 2 h -7 l -4 4 v -4 h -1 a 2 2 0 0 1 -2 -2 z" />
            {/* Two short lines inside, suggesting text content */}
            <line x1="8" y1="8.5" x2="14" y2="8.5" />
            <line x1="8" y1="11.5" x2="16" y2="11.5" />
          </svg>
        </BottomDockBtn>
      ) : null}
    </div>
  );
}



function BottomDockBtn({ active, onClick, title, children, badge = null, accent = '48, 48, 48', disabled = false, onContextMenu, tutorialId }) {
  const [hovered, setHovered] = useState(false);
  // Bottom dock bar is anchored at the bottom of the window — tooltips
  // would clip off-screen if they appeared below. Force above.
  return (
    <Tooltip label={title} side="top">
      <button
        type="button"
        onClick={onClick}
        onContextMenu={onContextMenu}
        disabled={disabled}
        // Keep aria-label for accessibility (screen readers); the visual
        // tooltip replaces the native title="" hover behavior.
        aria-label={title}
        data-tutorial-target={tutorialId}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: 'relative',
          width: 32, height: 32, borderRadius: 8,
          background: disabled
            ? 'transparent'
            : (active
                ? `rgba(${accent}, 0.4)`
                : (hovered ? 'rgba(255,255,255,0.08)' : 'transparent')),
          border: 'none',
          color: disabled
            ? 'rgba(255,255,255,0.25)'
            : (active ? '#fff' : (hovered ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.65)')),
          cursor: disabled ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
          flexShrink: 0,
          transition: 'background 0.15s, color 0.15s',
        }}
      >
        {children}
        {badge != null ? (
          <span style={{
            position: 'absolute', top: 1, right: 1,
            minWidth: 12, height: 12, padding: '0 3px',
            borderRadius: 6, fontSize: 8, fontWeight: 700, lineHeight: 1,
            background: `rgba(${accent}, 0.95)`, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.45)',
          }}>
            {badge > 99 ? '99+' : badge}
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
}


/* =========================================================================
 *  PanelResizeHandle — invisible drag strip on the inner edge of the side
 *  panel. Lets the user widen or narrow the panel by dragging the strip;
 *  releases commit the new width via `onCommitWidth`.
 *
 *  Tracking happens locally during the drag for immediate feedback (the
 *  panel width updates frame-by-frame as the cursor moves), but only the
 *  final value is persisted by the caller.
 *
 *  Bounds: 240..720 px. Below 240 the panel becomes unusable; above 720
 *  it dominates the immersive view.
 * ========================================================================= */
function PanelResizeHandle({ side, currentWidth, onCommitWidth }) {
  const [hovered, setHovered] = useState(false);
  const dragRef = useRef(null);

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    // Capture the starting cursor X and width so we can compute deltas
    // without needing to read the panel rect on each move (which would
    // re-trigger layout). Sign of the delta depends on which side the
    // panel is on: right-side panel widens when dragged left.
    dragRef.current = {
      startX: e.clientX,
      startWidth: currentWidth,
    };
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      // Right-side panel: drag handle is on its left edge. Moving the cursor
      // LEFT (dx < 0) widens the panel. So new width = startWidth - dx.
      // Left-side panel: handle is on the right edge; LEFT drag narrows.
      const sign = side === 'right' ? -1 : 1;
      const next = Math.round(dragRef.current.startWidth + sign * dx);
      const clamped = Math.max(240, Math.min(720, next));
      onCommitWidth?.(clamped);
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      style={{
        position: 'absolute',
        top: 0, bottom: 0,
        // Inner edge: right-side panel exposes its LEFT edge; left-side its RIGHT.
        ...(side === 'right' ? { left: 0 } : { right: 0 }),
        width: 6,
        zIndex: 10,
        cursor: 'ew-resize',
        // Subtle visual feedback on hover so the user discovers the handle.
        // The 1px line lives in the centre of the 6px hit zone.
        background: 'transparent',
      }}
    >
      {/* Visible 1px guide line — appears on hover only so the resting
          state is invisible. */}
      <div style={{
        position: 'absolute',
        top: '15%', bottom: '15%',
        ...(side === 'right' ? { left: 2 } : { right: 2 }),
        width: 2, borderRadius: 2,
        background: hovered ? 'rgba(255,255,255,0.4)' : 'transparent',
        transition: 'background 160ms ease',
      }} />
    </div>
  );
}


function SideDock({
  collapsed,
  onToggleCollapsed,
  // Tutorial trigger — passed through from ImmersiveLibraryPage so the
  // SettingsTab rendered inside this component can wire its
  // "Open tutorial" button.
  onOpenTutorial,
  // Update history trigger — same pattern as onOpenTutorial.
  onOpenUpdateHistory,
  tab,
  onTabChange,
  tracks,
  library,
  libraryCount,
  search,
  onSearchChange,
  currentTrack,
  isPlaying,
  currentTime = 0,
  lyricsData = null,
  onShowLyricsPanel,
  selectedId,
  setSelectedId,
  hovered,
  setHovered,
  onPlayTrack,
  onPlayPauseTrack,
  onImportFiles,
  onImportFolder,
  importing,
  setImporting,
  canRemove,
  onRemoveFromLibrary,
  canEdit,
  onEditTrack,
  canEditAlbum,
  onEditAlbum,
  playlists = [],
  playlistCoverMap = new Map(),
  openPlaylistId,
  openPlaylistTracks,
  onNewPlaylist,
  onEditPlaylist,
  onDeletePlaylist,
  onRemoveTracksFromPlaylist,
  canAddToPlaylist,
  onAddToPlaylist,
  accent,
  spotifyCredsRefreshKey,
  onSpotifyImportDone,
  onSpotifyCredsSaved,
  uiFontId,
  onSetUiFontId,
  uiFontStack,
  animateGradient,
  onSetAnimateGradient,
  beatReactive = false,
  onSetBeatReactive,
  coverFullscreenEnabled = true,
  onSetCoverFullscreenEnabled,
  pinnableTabsEnabled = false,
  onSetPinnableTabsEnabled,
  hiddenTabIds = [],
  onSetHiddenTabIds,
  dockCollapseAnimationEnabled = false,
  onSetDockCollapseAnimationEnabled,
  randomButtonEnabled = false,
  onSetRandomButtonEnabled,
  onPlayRandom,
  breathingDockPillEnabled = false,
  onSetBreathingDockPillEnabled,
  dockTransparentEnabled = false,
  onSetDockTransparentEnabled,
  liquidGlassDockEnabled = false,
  onSetLiquidGlassDockEnabled,
  journalTabEnabled = false,
  onSetJournalTabEnabled,
  queuePainterEnabled = false,
  onSetQueuePainterEnabled,
  recentlyPlayedEnabled = true,
  onSetRecentlyPlayedEnabled,
  onShowOnboarding,
  firstTimeSparkleEnabled = false,
  onSetFirstTimeSparkleEnabled,
  trackOfMomentEnabled = false,
  onSetTrackOfMomentEnabled,
  clickToFilterEnabled = false,
  onSetClickToFilterEnabled,
  onFilterByText,
  artistInfoEnabled = false,
  onSetArtistInfoEnabled,
  lastFmApiKey = '',
  onSetLastFmApiKey,
  creditsEnabled = false,
  onSetCreditsEnabled,
  videosEnabled = false,
  onSetVideosEnabled,
  edgeBleedEnabled = false,
  onSetEdgeBleedEnabled,
  ambientMode = 'idle',
  onSetAmbientMode,
  ambientCustomDelaySec = 30,
  onSetAmbientCustomDelaySec,
  transitionMode = 'off',
  onSetTransitionMode,
  crossfadeSec = 6,
  onSetCrossfadeSec,
  twoPaneEnabled = false,
  onSetTwoPaneEnabled,
  librarySwitcherStyle = 'chip',
  onSetLibrarySwitcherStyle,
  pinnedPlaylists = [],
  onTogglePinnedPlaylist,
  discordPresenceEnabled = false,
  onSetDiscordPresenceEnabled,
  discordAppId = '',
  onSetDiscordAppId,
  imgbbApiKey = '',
  onSetImgbbApiKey,
  onReloadLibrary,
  panelResizableEnabled = false,
  onSetPanelResizableEnabled,
  dockDraggableEnabled = false,
  onSetDockDraggableEnabled,
  panelWidth = 340,
  onSetPanelWidth,
  playEvents = [],
  onResetStats,
  statsRangeTabsEnabled = true,
  onSetStatsRangeTabsEnabled,
  // Right-click handler factory provided by the page so the popover can be
  // owned at page level (where it can layer above the dock without z-index
  // games inside the dock itself).
  tabContextHandler = () => undefined,
  onToggleFavorite,
  queue = [],
  currentIndex = -1,
  onAddToQueue,
  onPlayNext,
  onRemoveFromQueue,
  onReorderQueue,
  onClearUpNext,
  onJumpToQueueIndex,
  releases = [],
  followedArtists = [],
  followOverrides = [],
  releasesRefreshing = false,
  onRefreshReleases,
  onAddFollowedArtist,
  onExcludeFollowedArtist,
  onClearFollowedArtistOverride,
  onClearLibrary,
  onShowCandidatePicker,
  onTrackContextMenu,
  contextMenusEnabled,
  onSetContextMenusEnabled,
  side = 'right',
  onSetSide,
  forceOpaque = false,
}) {
  // No complex mounting logic needed — the expanded content is always in the
  // DOM from first render. When `collapsed`, it's hidden via display:none but
  // React has already mounted LibraryTab, built the albums memo, and set up
  // VirtualTrackList's observers. First user-open is just a CSS display flip,
  // which is instant.

  // Disable the expensive backdrop-filter during width transitions. The blur
  // has to re-sample and re-blur the entire background every frame of the
  // animation, which is the main source of jank. We swap it for a solid
  // opaque background during the ~280ms transition, then restore the glass.
  const [isAnimating, setIsAnimating] = useState(false);
  const animTimerRef = useRef(null);

  useEffect(() => {
    setIsAnimating(true);
    if (animTimerRef.current) clearTimeout(animTimerRef.current);
    // Match whichever collapse animation is active. The collapse-to-edge
    // mode runs ~340ms; the default slide is ~280ms. Either way we give a
    // small safety buffer so backdrop-filter doesn't reactivate too early.
    const dur = dockCollapseAnimationEnabled ? 380 : 320;
    animTimerRef.current = setTimeout(() => setIsAnimating(false), dur);
    return () => {
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
    };
  }, [collapsed, dockCollapseAnimationEnabled]);

  /**
   * Import an entire album release via iTunes → yt-dlp. The process:
   *   1. Ask the main process to look up all tracks on the album (iTunes)
   *   2. For each track, invoke the existing importFromYoutubeSearch IPC
   *      (same downloader as the Find tab)
   *   3. Report per-track progress via the provided callback
   *
   * Returns { ok, completed, failed, total, error?, failures? }.
   */
  const handleImportRelease = useCallback(async (release, onProgress) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.lookupReleaseAlbumTracks || !api?.importFromYoutubeSearch) {
      return { ok: false, error: 'Import not available' };
    }
    // Step 1 — pull track list from iTunes
    let tracks = [];
    try {
      const r = await api.lookupReleaseAlbumTracks(release.collectionId);
      if (!r?.ok) return { ok: false, error: r?.error || 'Could not fetch tracks' };
      tracks = r.tracks || [];
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
    if (!tracks.length) return { ok: false, error: 'No tracks on this album' };

    console.log(`[import-release] "${release.collectionName}" — ${tracks.length} tracks to download`);

    // Step 2 — download each track in sequence
    onProgress?.({ status: 'downloading', current: 0, total: tracks.length });
    let completed = 0;
    let failed = 0;
    const failures = [];
    for (let i = 0; i < tracks.length; i += 1) {
      const t = tracks[i];
      onProgress?.({
        status: 'downloading',
        current: i + 1,
        total: tracks.length,
      });
      try {
        // IMPORTANT: main.js expects `artists` to be a comma-joined string,
        // not an array (the Spotify client builds them that way). Must pass
        // a string here so yt-dlp receives a clean search query.
        const artistStr = t.artistName || release.artistName || '';
        const res = await api.importFromYoutubeSearch({
          title: t.trackName,
          artists: artistStr,
          album: t.collectionName || release.collectionName,
          albumArtUrl: t.artworkUrl || release.artworkUrl,
          durationMs: t.trackTimeMillis || 0,
          // Synthetic ID so the importer's dedupe logic has something stable.
          spotifyId: `itunes:${t.trackId}`,
          // Track position from iTunes (sorted by trackNumber already).
          trackNumber: t.trackNumber || null,
          discNumber: null,  // iTunes lookup doesn't expose disc numbers
          // iTunes flags each track as 'explicit' / 'cleaned' / 'notExplicit';
          // main.js maps that to a boolean. Used by the downloader's tier
          // selection AND stored on the track for the UI badge.
          explicit: t.explicit,
        });
        if (res?.ok && res.track) {
          onSpotifyImportDone?.(res.track);
          completed += 1;
          console.log(`[import-release]   ✓ ${t.trackName}`);
        } else {
          failed += 1;
          const reason = res?.error || 'unknown error';
          failures.push({ title: t.trackName, reason });
          console.log(`[import-release]   ✗ ${t.trackName} — ${reason}`);
        }
      } catch (e) {
        failed += 1;
        const reason = String(e?.message || e);
        failures.push({ title: t.trackName, reason });
        console.error(`[import-release]   ✗ ${t.trackName} — threw:`, reason);
      }
    }
    console.log(`[import-release] "${release.collectionName}" done — ${completed}/${tracks.length} ok, ${failed} failed`);
    return { ok: true, completed, failed, total: tracks.length, failures };
  }, [onSpotifyImportDone]);

  return (
    <aside
      style={{
        position: 'absolute',
        top: 44,
        // Leave room at the bottom for the BottomDockBar (sits at bottom 16,
        // ~44px tall, plus a gap so the panel doesn't visually crowd it).
        bottom: 76,
        // Sits flush against the chosen edge (the bottom dock bar replaced
        // the side rail, so there's no rail to offset around anymore).
        ...(side === 'right'
          ? { right: 12 }
          : { left: 12 }
        ),
        // Panel width — respects the user's chosen size when the resize
        // feature is enabled. Falls back to the historical default 340px
        // otherwise. Bounds enforced upstream (240..720) so we trust the
        // value here.
        width: panelResizableEnabled ? panelWidth : 340,
        zIndex: 5,
        display: 'flex', flexDirection: 'column',
        borderRadius: 18,
        background: (isAnimating || forceOpaque) ? 'rgba(18,18,20,0.92)' : 'rgba(18,18,20,0.62)',
        backdropFilter: (isAnimating || forceOpaque) ? 'none' : 'blur(30px) saturate(1.6)',
        WebkitBackdropFilter: (isAnimating || forceOpaque) ? 'none' : 'blur(30px) saturate(1.6)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.07)',
        overflow: 'hidden',
        // Panel collapse animation. Two modes:
        //
        //  default       slides off-screen toward the panel's outside edge,
        //                fades to 0 opacity. Reliable, snappy, the original.
        //
        //  collapse-to-edge (DEV)  scales toward the bottom-inner corner of
        //                the panel — the corner closest to the centered
        //                bottom-dock pill — while translating downward and
        //                blurring slightly. The visual reads as the panel
        //                collapsing INTO the dock pill, which makes the dock
        //                feel like the source of truth for the panel.
        //
        // Both share the same `pointerEvents: none` + `opacity: 0` end state
        // so collapsed UI never catches clicks.
        ...(dockCollapseAnimationEnabled ? {
          transformOrigin: side === 'right' ? '0% 100%' : '100% 100%',
          transform: collapsed
            ? `translateY(40px) scale(0.05)`
            : 'translateY(0) scale(1)',
          opacity: collapsed ? 0 : 1,
          filter: collapsed ? 'blur(4px)' : 'blur(0)',
          pointerEvents: collapsed ? 'none' : 'auto',
          // Slightly longer + a custom curve that decelerates hard near the
          // end, so the final settle is smooth rather than rubbery.
          transition: 'transform 0.34s cubic-bezier(0.32, 0.0, 0.16, 1), opacity 0.26s ease, filter 0.28s ease, background 0.25s ease',
        } : {
          // When `collapsed` (open=false), translate the panel off-screen in
          // the direction of its edge. Combined with `pointerEvents: none` so
          // hidden content doesn't catch clicks.
          transform: collapsed
            ? `translateX(${side === 'right' ? 'calc(100% + 24px)' : 'calc(-100% - 24px)'})`
            : 'translateX(0)',
          opacity: collapsed ? 0 : 1,
          pointerEvents: collapsed ? 'none' : 'auto',
          transition: 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.22s ease, background 0.25s ease',
        }),
        WebkitAppRegion: 'no-drag',
      }}
    >
      {/* Resize handle — only when the resize feature is enabled. Sits on
          the panel's inner edge: left edge for a right-side panel, right
          edge for a left-side panel. Absolutely positioned so it doesn't
          push content. */}
      {panelResizableEnabled && !collapsed ? (
        <PanelResizeHandle
          side={side}
          currentWidth={panelWidth}
          onCommitWidth={onSetPanelWidth}
        />
      ) : null}

      {/* Expanded content */}
      <div style={{
        display: 'flex',
        flex: 1, flexDirection: 'column', minHeight: 0,
      }}>
        {/* Unified identity header — icon tile + thin title + subtitle, shared
            by every tab. The Explore tab renders its own actions (refresh /
            find-follow) inside its body below this. */}
        {(() => {
          const playlistId = (typeof tab === 'string' && tab.startsWith('playlist:')) ? tab.slice('playlist:'.length) : null;
          const HEADERS = {
            find:     { title: 'Find',     sub: 'Search across your whole library', icon: <Icons.Search /> },
            library:  { title: 'Library',  sub: `${libraryCount} track${libraryCount === 1 ? '' : 's'} in your collection`, icon: <Icons.LibrarySidebar /> },
            new:      { title: 'Explore',  sub: 'New releases from artists you follow', icon: <Icons.NewReleases /> },
            settings: { title: 'Settings', sub: 'Preferences, appearance & features', icon: <Icons.Settings /> },
            stats:    { title: 'Stats',    sub: 'Your listening, by the numbers', icon: <Icons.Stats /> },
            queue:    { title: 'Queue',    sub: 'What’s playing next', icon: (
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="15" y2="18" /><polyline points="3 6 4 7 6 5" /><polyline points="3 12 4 13 6 11" /></svg>
            ) },
            journal:  { title: 'Journal',  sub: 'Your listening diary', icon: (
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 5c3 0 7 1 10 2 3-1 7-2 10-2v14c-3 0-7 1-10 2-3-1-7-2-10-2V5z" /><line x1="12" y1="7" x2="12" y2="21" /></svg>
            ) },
            track:    { title: 'Track',    sub: 'Now playing', icon: (
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="7" cy="18" r="3" /><path d="M10 18V5l10-2v13" /><circle cx="17" cy="16" r="3" /></svg>
            ) },
          };
          const h = playlistId ? { title: 'Playlist', sub: 'Your mix', icon: (
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="15" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="11" y2="18" /><circle cx="18" cy="16" r="3" /><path d="M21 16V8" /></svg>
          ) } : (HEADERS[tab] || HEADERS.library);
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 14px 12px 14px', minWidth: 0 }}>
              <span style={{
                width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: `linear-gradient(135deg, rgba(${accent},0.9), rgba(${accent},0.4))`,
                color: '#fff', boxShadow: `0 6px 18px rgba(${accent},0.32)`,
              }}>
                {h.icon}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 300, letterSpacing: '-0.01em', color: '#fff', lineHeight: 1 }}>{h.title}</div>
                <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.4)', marginTop: 4, letterSpacing: '0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.sub}</div>
              </div>
              {tab === 'settings' && typeof onOpenUpdateHistory === 'function' ? (
                <button type="button" onClick={onOpenUpdateHistory}
                  title="What's new — update history" aria-label="Update history"
                  style={{
                    width: 30, height: 30, borderRadius: 9, flexShrink: 0, padding: 0,
                    border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
                    color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background .15s, color .15s, border-color .15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = `rgba(${accent},0.16)`; e.currentTarget.style.borderColor = `rgba(${accent},0.45)`; e.currentTarget.style.color = '#fff'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" />
                  </svg>
                </button>
              ) : null}
            </div>
          );
        })()}
        <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />

        {/* LibraryTab stays mounted across tab switches — expensive albums memo
            only computes once per library change. Other tabs mount/unmount
            normally since they're cheap. */}
        <div style={{ display: tab === 'library' ? 'flex' : 'none', flex: 1, flexDirection: 'column', minHeight: 0 }}>
          <LibraryTab
            tracks={tracks}
            library={library}
            libraryCount={libraryCount}
            search={search}
            onSearchChange={onSearchChange}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            hovered={hovered}
            setHovered={setHovered}
            onPlayTrack={onPlayTrack}
            onPlayPauseTrack={onPlayPauseTrack}
            onImportFiles={onImportFiles}
            onImportFolder={onImportFolder}
            importing={importing}
            canRemove={canRemove}
            onRemoveFromLibrary={onRemoveFromLibrary}
            canEdit={canEdit}
            onEditTrack={onEditTrack}
            canEditAlbum={canEditAlbum}
            onEditAlbum={onEditAlbum}
            canAddToPlaylist={canAddToPlaylist}
            onAddToPlaylist={onAddToPlaylist}
            onAddToQueue={onAddToQueue}
            onPlayNext={onPlayNext}
            onToggleFavorite={onToggleFavorite}
            onTrackContextMenu={onTrackContextMenu}
            playlists={playlists}
            playlistCoverMap={playlistCoverMap}
            onOpenPlaylist={(id) => onTabChange(`playlist:${id}`)}
            onNewPlaylist={onNewPlaylist}
            firstTimeSparkleEnabled={firstTimeSparkleEnabled}
            clickToFilterEnabled={clickToFilterEnabled}
            onFilterByText={onFilterByText}
            twoPaneEnabled={twoPaneEnabled}
            librarySwitcherStyle={librarySwitcherStyle}
            pinnedPlaylists={pinnedPlaylists}
            onTogglePinnedPlaylist={onTogglePinnedPlaylist}
            playEvents={playEvents}
            recentlyPlayedEnabled={recentlyPlayedEnabled}
            accent={accent}
          />
        </div>
        <div style={{ display: tab === 'find' ? 'contents' : 'none' }}>
          <FindTab
            importing={importing}
            setImporting={setImporting}
            spotifyCredsRefreshKey={spotifyCredsRefreshKey}
            onSpotifyImportDone={onSpotifyImportDone}
            onOpenSettings={() => onTabChange('settings')}
            accent={accent}
            library={library}
            onShowCandidatePicker={onShowCandidatePicker}
            isActive={tab === 'find'}
          />
        </div>
        {tab === 'new' ? (
          <NewReleasesTab
            releases={releases}
            followedArtists={followedArtists}
            followOverrides={followOverrides}
            refreshing={releasesRefreshing}
            onRefresh={onRefreshReleases}
            onAddFollowedArtist={onAddFollowedArtist}
            onExcludeFollowedArtist={onExcludeFollowedArtist}
            onClearFollowedArtistOverride={onClearFollowedArtistOverride}
            onImportRelease={handleImportRelease}
            library={library}
            accent={accent}
            onShowCandidatePicker={onShowCandidatePicker}
            onSpotifyImportDone={onSpotifyImportDone}
          />
        ) : tab === 'settings' ? (
          <SettingsTab
            accent={accent}
            uiFontId={uiFontId}
            onSetUiFontId={onSetUiFontId}
            uiFontStack={uiFontStack}
            onSpotifyCredsSaved={onSpotifyCredsSaved}
            animateGradient={animateGradient}
            onSetAnimateGradient={onSetAnimateGradient}
            beatReactive={beatReactive}
            onSetBeatReactive={onSetBeatReactive}
            coverFullscreenEnabled={coverFullscreenEnabled}
            onSetCoverFullscreenEnabled={onSetCoverFullscreenEnabled}
            pinnableTabsEnabled={pinnableTabsEnabled}
            onSetPinnableTabsEnabled={onSetPinnableTabsEnabled}
            hiddenTabIds={hiddenTabIds}
            onSetHiddenTabIds={onSetHiddenTabIds}
            dockCollapseAnimationEnabled={dockCollapseAnimationEnabled}
            onSetDockCollapseAnimationEnabled={onSetDockCollapseAnimationEnabled}
            randomButtonEnabled={randomButtonEnabled}
            onSetRandomButtonEnabled={onSetRandomButtonEnabled}
            breathingDockPillEnabled={breathingDockPillEnabled}
            onSetBreathingDockPillEnabled={onSetBreathingDockPillEnabled}
            dockTransparentEnabled={dockTransparentEnabled}
            onSetDockTransparentEnabled={onSetDockTransparentEnabled}
            liquidGlassDockEnabled={liquidGlassDockEnabled}
            onSetLiquidGlassDockEnabled={onSetLiquidGlassDockEnabled}
            journalTabEnabled={journalTabEnabled}
            onSetJournalTabEnabled={onSetJournalTabEnabled}
            queuePainterEnabled={queuePainterEnabled}
            onSetQueuePainterEnabled={onSetQueuePainterEnabled}
            recentlyPlayedEnabled={recentlyPlayedEnabled}
            onSetRecentlyPlayedEnabled={onSetRecentlyPlayedEnabled}
            onShowOnboarding={onShowOnboarding}
            firstTimeSparkleEnabled={firstTimeSparkleEnabled}
            onSetFirstTimeSparkleEnabled={onSetFirstTimeSparkleEnabled}
            trackOfMomentEnabled={trackOfMomentEnabled}
            onSetTrackOfMomentEnabled={onSetTrackOfMomentEnabled}
            statsRangeTabsEnabled={statsRangeTabsEnabled}
            onSetStatsRangeTabsEnabled={onSetStatsRangeTabsEnabled}
            clickToFilterEnabled={clickToFilterEnabled}
            onSetClickToFilterEnabled={onSetClickToFilterEnabled}
            librarySwitcherStyle={librarySwitcherStyle}
            onSetLibrarySwitcherStyle={onSetLibrarySwitcherStyle}
            artistInfoEnabled={artistInfoEnabled}
            onSetArtistInfoEnabled={onSetArtistInfoEnabled}
            lastFmApiKey={lastFmApiKey}
            onSetLastFmApiKey={onSetLastFmApiKey}
            creditsEnabled={creditsEnabled}
            onSetCreditsEnabled={onSetCreditsEnabled}
            videosEnabled={videosEnabled}
            onSetVideosEnabled={onSetVideosEnabled}
            edgeBleedEnabled={edgeBleedEnabled}
            onSetEdgeBleedEnabled={onSetEdgeBleedEnabled}
            ambientMode={ambientMode}
            onSetAmbientMode={onSetAmbientMode}
            ambientCustomDelaySec={ambientCustomDelaySec}
            onSetAmbientCustomDelaySec={onSetAmbientCustomDelaySec}
            transitionMode={transitionMode}
            onSetTransitionMode={onSetTransitionMode}
            crossfadeSec={crossfadeSec}
            onSetCrossfadeSec={onSetCrossfadeSec}
            twoPaneEnabled={twoPaneEnabled}
            onSetTwoPaneEnabled={onSetTwoPaneEnabled}
            discordPresenceEnabled={discordPresenceEnabled}
            onSetDiscordPresenceEnabled={onSetDiscordPresenceEnabled}
            discordAppId={discordAppId}
            onSetDiscordAppId={onSetDiscordAppId}
            imgbbApiKey={imgbbApiKey}
            onSetImgbbApiKey={onSetImgbbApiKey}
            onReloadLibrary={onReloadLibrary}
            panelResizableEnabled={panelResizableEnabled}
            onSetPanelResizableEnabled={onSetPanelResizableEnabled}
            dockDraggableEnabled={dockDraggableEnabled}
            onSetDockDraggableEnabled={onSetDockDraggableEnabled}
            onClearLibrary={onClearLibrary}
            dockSide={side}
            onSetDockSide={onSetSide}
            contextMenusEnabled={contextMenusEnabled}
            onSetContextMenusEnabled={onSetContextMenusEnabled}
            onOpenTutorial={onOpenTutorial}
            onOpenUpdateHistory={onOpenUpdateHistory}
          />
        ) : tab === 'stats' ? (
          <StatsTab
            library={library}
            playlists={playlists}
            onPlayTrack={onPlayTrack}
            accent={accent}
            playEvents={playEvents}
            onResetStats={onResetStats}
            rangeTabsEnabled={statsRangeTabsEnabled}
          />
        ) : tab === 'queue' ? (
          <QueueTab
            queue={queue}
            currentIndex={currentIndex}
            onJumpToQueueIndex={onJumpToQueueIndex}
            onRemoveFromQueue={onRemoveFromQueue}
            onReorderQueue={onReorderQueue}
            onClearUpNext={onClearUpNext}
            accent={accent}
            painterAvailable={queuePainterEnabled}
            currentTime={currentTime}
          />) : tab === 'track' ? (
          <TrackTab
            currentTrack={currentTrack}
            library={library}
            playEvents={playEvents}
            accent={accent}
            onPlayTrack={onPlayTrack}
            onFilterByText={onFilterByText}
            clickToFilterEnabled={clickToFilterEnabled}
            onTabChange={onTabChange}
            currentTime={currentTime}
            lyricsData={lyricsData}
            onShowLyricsPanel={onShowLyricsPanel}
            artistInfoEnabled={artistInfoEnabled}
            lastFmApiKey={lastFmApiKey}
            creditsEnabled={creditsEnabled}
            videosEnabled={videosEnabled}
          />
        ) : (typeof tab === 'string' && tab.startsWith('playlist:')) ? (
          (() => {
            const pl = playlists.find((p) => p.id === openPlaylistId);
            if (!pl) {
              return (
                <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: 11.5 }}>
                  Playlist not found.
                </div>
              );
            }
            return (
              <PlaylistView
                playlist={pl}
                tracks={openPlaylistTracks}
                currentTrack={currentTrack}
                isPlaying={isPlaying}
                hovered={hovered}
                setHovered={setHovered}
                selectedId={selectedId}
                setSelectedId={setSelectedId}
                onPlayTrack={onPlayTrack}
                onPlayPauseTrack={onPlayPauseTrack}
                onEditPlaylist={onEditPlaylist}
                onDeletePlaylist={onDeletePlaylist}
                onRemoveTracksFromPlaylist={onRemoveTracksFromPlaylist}
                onTrackContextMenu={onTrackContextMenu}
                onBack={() => onTabChange('library')}
                accent={accent}
              />
            );
          })()
        ) : null}
      </div>
    </aside>
  );
}

function TabBtn({ children, active, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        flex: 1, minWidth: 0,
        padding: '6px 3px', borderRadius: 9, border: 'none',
        background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
        color: active ? '#fff' : hov ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.55)',
        fontSize: 11, fontWeight: 600, cursor: 'pointer',
        letterSpacing: '0.01em',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}
    >
      {children}
    </button>
  );
}

/**
 * Render a playlist's thumbnail — uses the custom cover if set, otherwise
 * builds a 2x2 mosaic from the first 4 unique track covers in the playlist.
 * Falls back gracefully for playlists with 0/1/2/3 covers.
 *
 * Props:
 *  - playlist: the playlist object (id, name, coverArt)
 *  - trackCovers: array of cover URLs from the playlist's tracks (already
 *    filtered/deduped by the caller; may be empty)
 *  - size: pixel size of the square thumbnail
 */


function CollapsedRail({
  tab, onTabChange, libraryCount, queueCount = 0, accent = '48, 48, 48',
  playlists = [], playlistCoverMap = new Map(), onNewPlaylist,
}) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      paddingTop: 14, minHeight: 0,
    }}>
      {/* Top section — fixed system tabs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
        <RailIcon active={tab === 'find'} onClick={() => onTabChange('find')} title="Find">
          <Icons.Search />
        </RailIcon>
        <RailIcon active={tab === 'library'} onClick={() => onTabChange('library')} title={`Library · ${libraryCount}`}>
          <Icons.LibrarySidebar />
        </RailIcon>
        <RailIcon active={tab === 'new'} onClick={() => onTabChange('new')} title="Explore">
          <Icons.NewReleases />
        </RailIcon>
        <RailIcon active={tab === 'settings'} onClick={() => onTabChange('settings')} title="Settings">
          <Icons.Settings />
        </RailIcon>
      </div>

      {/* Divider — only shown if there are playlists or the new-playlist button is available */}
      {(playlists.length > 0 || typeof onNewPlaylist === 'function') ? (
        <div style={{ width: 20, height: 1, background: 'rgba(255,255,255,0.1)', margin: '10px 0 8px', flexShrink: 0 }} />
      ) : null}

      {/* Middle section — scrollable playlist stack. The 4px top padding gives
          the active-playlist outline room to render without crossing the
          divider above. */}
      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        padding: '4px 0 4px', width: '100%',
        scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.15) transparent',
      }}>
        {playlists.map((pl) => {
          const railTab = `playlist:${pl.id}`;
          const active = tab === railTab;
          return (
            <button
              key={pl.id}
              type="button"
              onClick={() => onTabChange(railTab)}
              title={pl.name}
              aria-label={`Playlist: ${pl.name}`}
              style={{
                width: 34, height: 34, borderRadius: 10, border: 'none',
                padding: 0, cursor: 'pointer', flexShrink: 0,
                background: 'transparent', overflow: 'hidden',
                outline: active ? '2px solid rgba(255,255,255,0.85)' : '2px solid transparent',
                outlineOffset: active ? 2 : 0,
                transition: 'outline-color 0.15s, transform 0.1s',
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.transform = 'scale(1.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}>
              <PlaylistThumb playlist={pl} trackCovers={playlistCoverMap.get(pl.id) || []} size={34} />
            </button>
          );
        })}
      </div>

      {/* Bottom section — + New playlist button pinned */}
      {typeof onNewPlaylist === 'function' ? (
        <button
          type="button"
          onClick={onNewPlaylist}
          title="New playlist"
          aria-label="New playlist"
          style={{
            flexShrink: 0, marginTop: 4, marginBottom: 10,
            width: 34, height: 34, borderRadius: 10,
            border: '1px dashed rgba(255,255,255,0.2)', background: 'transparent',
            color: 'rgba(255,255,255,0.6)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, lineHeight: 1, fontWeight: 300,
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)';
            e.currentTarget.style.color = '#fff';
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
            e.currentTarget.style.color = 'rgba(255,255,255,0.6)';
            e.currentTarget.style.background = 'transparent';
          }}>
          +
        </button>
      ) : null}

      {/* Track count footer — only shown when no playlists (otherwise it's too cramped) */}
      {playlists.length === 0 && typeof onNewPlaylist !== 'function' ? (
        <div style={{
          marginTop: 'auto', marginBottom: 16,
          writingMode: 'vertical-rl', transform: 'rotate(180deg)',
          fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.35)', fontWeight: 700,
          textTransform: 'uppercase',
        }}>
          {libraryCount} {libraryCount === 1 ? 'track' : 'tracks'}
        </div>
      ) : null}
    </div>
  );
}


function RailIcon({ children, active, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: 34, height: 34, borderRadius: 10, border: 'none',
        background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
        color: active ? '#fff' : 'rgba(255,255,255,0.6)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {children}
    </button>
  );
}


export { NavRail, NavRailIcon, BottomDockBar, BottomDockBtn, PanelResizeHandle, SideDock, TabBtn, CollapsedRail, RailIcon };
