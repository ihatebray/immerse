import React, { useState, useEffect, useRef, useCallback } from 'react';
import { formatTime, parseLRC, activeLyricIndex, sortStampedLines } from './mediaUtils.js';

function LyricsEditor({ track, currentTime, existingSynced, existingPlain, accent, onSeek, onSave, onCancel }) {
  // 'edit' = editing text lines, 'sync' = tap-to-sync stamping mode
  const [step, setStep] = useState('edit');
  const [text, setText] = useState(() => {
    // Seed from existing synced lines or plain text
    if (existingSynced?.length) return existingSynced.map((l) => l.text).join('\n');
    if (existingPlain) return existingPlain;
    return '';
  });
  // Array of { text, time: number|null }
  const [stampedLines, setStampedLines] = useState([]);
  const [syncIdx, setSyncIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const syncContainerRef = useRef(null);
  const lineElsRef = useRef([]);
  const api = typeof window !== 'undefined' ? window.electronAPI : null;

  // Parse text into lines when entering sync mode
  const enterSyncMode = () => {
    const lines = text.split('\n').filter((l) => l.trim());
    if (!lines.length) return;
    // Pre-fill timestamps from existing synced data if line text matches
    const existingMap = new Map((existingSynced || []).map((l) => [l.text.trim().toLowerCase(), l.time]));
    setStampedLines(lines.map((l) => ({
      text: l.trim(),
      time: existingMap.get(l.trim().toLowerCase()) ?? null,
    })));
    setSyncIdx(0);
    setStep('sync');
  };

  // Tap handler — stamp current playback time onto the current line
  const stampCurrent = useCallback(() => {
    setStampedLines((prev) => {
      const next = [...prev];
      if (syncIdx < next.length) {
        next[syncIdx] = { ...next[syncIdx], time: currentTime };
      }
      // Keep stamped lines sorted by time, with unstamped (time === null)
      // lines at the bottom in their original order. This way the editor
      // list always reads in playback order — critical for songs with
      // choruses and verse repeats that don't follow text order.
      return sortStampedLines(next);
    });
    // After sorting, the next-to-stamp position is the first line
    // whose time is still null. Compute that fresh rather than
    // incrementing — sorting may have shuffled positions.
    setStampedLines((cur) => {
      const firstUnstamped = cur.findIndex((l) => l.time === null);
      setSyncIdx(firstUnstamped === -1 ? cur.length : firstUnstamped);
      return cur;
    });
  }, [syncIdx, currentTime]);

  // Keyboard: space to stamp while in sync mode
  useEffect(() => {
    if (step !== 'sync') return;
    const handler = (e) => {
      // Don't capture if user is in a textarea/input
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        stampCurrent();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [step, stampCurrent]);

  // Auto-scroll to current sync line — scoped to container only, never bubbles to parents
  useEffect(() => {
    if (step !== 'sync') return;
    const container = syncContainerRef.current;
    const el = lineElsRef.current[syncIdx];
    if (!container || !el) return;
    const targetTop = el.offsetTop - container.clientHeight / 2 + el.offsetHeight / 2;
    container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
  }, [syncIdx, step]);

  // Save to DB
  const handleSave = async () => {
    if (!track || !api?.saveLyrics) return;
    setSaving(true);
    // Build LRC string from stamped lines
    const synced = stampedLines.filter((l) => l.time !== null);
    synced.sort((a, b) => a.time - b.time);
    const lrcStr = synced.map((l) => {
      const min = Math.floor(l.time / 60);
      const sec = l.time % 60;
      return `[${String(min).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}] ${l.text}`;
    }).join('\n');
    const plainStr = stampedLines.map((l) => l.text).join('\n');
    try {
      await api.saveLyrics({
        title: track.title || '',
        artist: track.artist || '',
        syncedLyrics: lrcStr || null,
        plainLyrics: plainStr || null,
      });
      onSave(parseLRC(lrcStr), plainStr);
    } catch (e) {
      console.error('Failed to save lyrics', e);
    } finally {
      setSaving(false);
    }
  };

  // Quick-save plain only (no sync)
  const handleSavePlainOnly = async () => {
    if (!track || !api?.saveLyrics) return;
    setSaving(true);
    try {
      await api.saveLyrics({
        title: track.title || '',
        artist: track.artist || '',
        syncedLyrics: null,
        plainLyrics: text || null,
      });
      onSave([], text || null);
    } catch (e) {
      console.error('Failed to save lyrics', e);
    } finally {
      setSaving(false);
    }
  };

  // Undo last stamp
  const undoLast = () => {
    if (syncIdx <= 0) return;
    const target = syncIdx - 1;
    setStampedLines((prev) => {
      const next = [...prev];
      next[target] = { ...next[target], time: null };
      return next;
    });
    setSyncIdx(target);
  };

  // Clear a specific line's timestamp
  const clearStamp = (i) => {
    setStampedLines((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], time: null };
      return next;
    });
    if (i < syncIdx) setSyncIdx(i);
  };

  const allStamped = stampedLines.length > 0 && stampedLines.every((l) => l.time !== null);
  const stampedCount = stampedLines.filter((l) => l.time !== null).length;

  const pillStyle = (active) => ({
    padding: '5px 12px', borderRadius: 16, border: 'none',
    background: active ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
    color: active ? '#fff' : 'rgba(255,255,255,0.5)',
    fontSize: 10.5, fontWeight: 600, cursor: 'pointer',
    transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.15s cubic-bezier(0.16,1,0.3,1)',
  });

  const btnBase = {
    padding: '7px 14px', borderRadius: 10, border: 'none', fontSize: 11, fontWeight: 600,
    cursor: 'pointer', transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.15s cubic-bezier(0.16,1,0.3,1)',
  };

  if (step === 'edit') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0 }}>
        {/* Header */}
        <div style={{ padding: '10px 8px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', flex: 1 }}>Edit lyrics</div>
          <button type="button" onClick={onCancel} style={{ ...btnBase, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', padding: '5px 10px' }}>Cancel</button>
        </div>
        <div style={{ padding: '0 8px 6px', fontSize: 10, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
          One line per row. When you're done, tap <strong style={{ color: 'rgba(255,255,255,0.7)' }}>Tap to sync</strong> to add timestamps while the song plays.
        </div>

        {/* Textarea */}
        <div style={{ flex: 1, padding: '0 8px', minHeight: 0 }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Paste or type lyrics here…\n\nOne line per row.\nEmpty lines are ignored.'}
            spellCheck={false}
            style={{
              width: '100%', height: '100%', boxSizing: 'border-box',
              padding: '12px 14px', borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(0,0,0,0.35)',
              color: 'rgba(255,255,255,0.85)',
              fontSize: 12.5, lineHeight: 1.7,
              resize: 'none', outline: 'none',
              fontFamily: 'inherit',
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(255,255,255,0.15) transparent',
            }}
          />
        </div>

        {/* Actions */}
        <div style={{ padding: '10px 8px 8px', display: 'flex', gap: 6 }}>
          <button type="button" onClick={handleSavePlainOnly} disabled={!text.trim() || saving}
            style={{ ...btnBase, flex: 1, background: 'rgba(255,255,255,0.08)', color: '#fff', opacity: !text.trim() ? 0.4 : 1 }}>
            {saving ? 'Saving…' : 'Save without sync'}
          </button>
          <button type="button" onClick={enterSyncMode} disabled={!text.trim()}
            style={{ ...btnBase, flex: 1, background: `rgba(${accent},0.25)`, color: '#fff', opacity: !text.trim() ? 0.4 : 1 }}>
            Tap to sync →
          </button>
        </div>
      </div>
    );
  }

  // Step 2: Tap-to-sync
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 8px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" onClick={() => setStep('edit')} style={{ ...pillStyle(false), display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px' }}>
          <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
          Edit
        </button>
        <div style={{ flex: 1, fontSize: 12, fontWeight: 700, color: '#fff', textAlign: 'center' }}>Tap to sync</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums' }}>
          {stampedCount}/{stampedLines.length}
        </div>
      </div>

      <div style={{ padding: '2px 8px 6px', fontSize: 10, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5, textAlign: 'center' }}>
        Play the song, then tap the button or press <strong style={{ color: 'rgba(255,255,255,0.65)' }}>Space</strong> as each line is sung.
      </div>

      {/* Playback time indicator */}
      <div style={{ padding: '0 8px 6px', textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
        {formatTime(currentTime)}
      </div>

      {/* Lines list */}
      <div ref={syncContainerRef} style={{
        flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '0 4px',
        overscrollBehavior: 'contain',
        scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.12) transparent',
        maskImage: 'linear-gradient(to bottom, #000 0%, #000 90%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, #000 0%, #000 90%, transparent 100%)',
      }}>
        {stampedLines.map((line, i) => {
          const isCurrent = i === syncIdx;
          const isStamped = line.time !== null;
          const isPast = isStamped && i < syncIdx;
          return (
            <div
              key={i}
              ref={(el) => { lineElsRef.current[i] = el; }}
              onClick={(e) => {
                // Plain click on a stamped line: seek audio AND make it
                //   the active sync cursor — so you can scrub to a
                //   specific line and continue syncing from there.
                // Plain click on an unstamped line: just move the
                //   cursor there (no audio seek — there's no timestamp
                //   to seek to yet).
                // Shift-click: jump the sync cursor without touching
                //   audio playback. Useful when you're already playing
                //   and want to commit to syncing from a line that's
                //   about to come up.
                setSyncIdx(i);
                if (isStamped && !e.shiftKey && onSeek) onSeek(line.time);
              }}
              title={isStamped
                ? 'Click: resume syncing here (and seek). Shift-click: just move the cursor.'
                : 'Click: resume syncing here.'}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '6px 8px', borderRadius: 8,
                background: isCurrent ? `rgba(${accent},0.12)` : 'transparent',
                borderLeft: isCurrent ? `2px solid rgba(${accent},0.7)` : '2px solid transparent',
                transition: 'background 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.2s cubic-bezier(0.16,1,0.3,1)',
                // Every line is clickable now — both stamped (seek+resume)
                // and unstamped (just resume). The cursor reflects that.
                cursor: 'pointer',
              }}
            >
              {/* Timestamp badge */}
              <div style={{
                flexShrink: 0, width: 42, fontSize: 9.5, fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                color: isStamped ? 'rgba(29,185,84,0.8)' : 'rgba(255,255,255,0.2)',
                paddingTop: 2, textAlign: 'right',
              }}>
                {isStamped ? formatTime(line.time) : '—:——'}
              </div>

              {/* Line text */}
              <div style={{
                flex: 1, fontSize: 12.5,
                fontWeight: isCurrent ? 600 : 400,
                color: isCurrent ? '#fff' : isPast ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.65)',
                lineHeight: 1.5,
                transition: 'color 0.2s',
              }}>
                {line.text}
              </div>

              {/* Clear button for stamped lines */}
              {isStamped ? (
                <button type="button" onClick={(e) => { e.stopPropagation(); clearStamp(i); }}
                  title="Remove timestamp"
                  style={{
                    flexShrink: 0, width: 18, height: 18, borderRadius: 9,
                    border: 'none', background: 'rgba(255,255,255,0.06)',
                    color: 'rgba(255,255,255,0.3)', fontSize: 10,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: 0,
                  }}>
                  ×
                </button>
              ) : null}
            </div>
          );
        })}
        <div style={{ height: 60 }} />
      </div>

      {/* Bottom action bar */}
      <div style={{
        padding: '8px 8px 8px', display: 'flex', gap: 6,
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}>
        {!allStamped ? (
          <>
            <button type="button" onClick={undoLast} disabled={syncIdx === 0}
              title="Undo last stamp"
              style={{
                ...btnBase, padding: '8px 10px',
                background: 'rgba(255,255,255,0.06)',
                color: syncIdx === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.7)',
              }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05 1.04-6.83 2.73L2.5 7.5v9h9l-3.19-3.19C9.8 12.21 11.08 11.5 12.5 11.5c2.65 0 4.88 1.77 5.57 4.19l2.62-.87C19.68 11.17 16.38 8 12.5 8z"/></svg>
            </button>
            {/* Jump to first unstamped — handy after the user has
                clicked around to seek/preview different lines and
                wants to snap back to "where they should be syncing
                next." Only enabled when (a) there's at least one
                stamped line behind us (so jumping makes sense) and
                (b) the cursor isn't already on the first unstamped. */}
            {(() => {
              const firstUnstamped = stampedLines.findIndex((l) => l.time === null);
              const canJump = firstUnstamped !== -1 && firstUnstamped !== syncIdx;
              return (
                <button type="button"
                  onClick={() => { if (firstUnstamped !== -1) setSyncIdx(firstUnstamped); }}
                  disabled={!canJump}
                  title="Jump to next unstamped line"
                  style={{
                    ...btnBase, padding: '8px 10px',
                    background: 'rgba(255,255,255,0.06)',
                    color: canJump ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)',
                  }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              );
            })()}
            <button type="button" onClick={stampCurrent} disabled={syncIdx >= stampedLines.length}
              style={{
                ...btnBase, flex: 1, padding: '10px 14px',
                background: `rgba(${accent},0.3)`,
                color: '#fff', fontSize: 12, fontWeight: 700,
                border: `1px solid rgba(${accent},0.4)`,
                opacity: syncIdx >= stampedLines.length ? 0.4 : 1,
              }}>
              ⏎ Stamp line {syncIdx < stampedLines.length ? syncIdx + 1 : ''}
            </button>
          </>
        ) : (
          <button type="button" onClick={handleSave} disabled={saving}
            style={{
              ...btnBase, flex: 1, padding: '10px 14px',
              background: '#1db954', color: '#000',
              fontSize: 12, fontWeight: 700,
            }}>
            {saving ? 'Saving…' : '✓ Save synced lyrics'}
          </button>
        )}
      </div>

      {/* Allow saving partially stamped */}
      {!allStamped && stampedCount > 0 ? (
        <div style={{ padding: '0 8px 8px' }}>
          <button type="button" onClick={handleSave} disabled={saving}
            style={{
              ...btnBase, width: '100%', padding: '6px 10px',
              background: 'rgba(255,255,255,0.05)',
              color: 'rgba(255,255,255,0.5)', fontSize: 10,
            }}>
            {saving ? 'Saving…' : `Save with ${stampedCount} synced line${stampedCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Karaoke-style synced lyrics — GPU-translated, no scroll.
 *
 * Past lines dim ~18%, future lines mid-grey, active line full white.
 */
function SyncedLyrics({
  lines, currentTime, accent, onSeek,
  fontSize = 15, lineHeight = 1.55,
  // --- Selection-for-sharing props ---
  // When `selection` is non-null, the panel enters "share-pick" mode:
  //   - Active-line auto-scroll freezes (so the user can read freely
  //     without the active line tugging the view away)
  //   - Clicks on lines extend/contract the highlight instead of seeking
  //   - Selected lines glow with the accent and a left-edge bar
  // Selection shape: { start: number, end: number } where end >= start,
  // both indices into `lines`.
  selection = null,
  onSelectLine,    // (idx) → toggle / extend selection
  onSelectStart,   // (idx) → enter selection mode anchored at idx
}) {
  const containerRef = useRef(null);
  const lineRefs = useRef([]);
  const [offset, setOffset] = useState(0);
  const activeIdx = activeLyricIndex(lines, currentTime);

  // Ensure refs array matches lines length.
  if (lineRefs.current.length !== lines.length) {
    lineRefs.current = Array(lines.length).fill(null);
  }

  const selecting = !!selection;

  // Compute translateY so the active line sits at the vertical center.
  // When the user is picking lines to share we FREEZE the offset — having
  // the lyric column auto-scroll under your finger would make it impossible
  // to select a stable range.
  useEffect(() => {
    if (selecting) return; // hold position while selecting
    const container = containerRef.current;
    const el = lineRefs.current[activeIdx];
    if (!container || !el || activeIdx < 0) {
      setOffset(0);
      return;
    }
    const containerH = container.clientHeight;
    const elTop = el.offsetTop;
    const elH = el.offsetHeight;
    setOffset(-(elTop - containerH / 2 + elH / 2));
  }, [activeIdx, lines.length, selecting]);

  // Long-press tracking for entering selection mode. 380ms hold to match
  // the platform feel of a mobile long-press without being so slow that
  // a casual click ever triggers it.
  const pressTimerRef = useRef(null);
  const pressedRef = useRef(null); // {idx, t0, fired}
  const LONG_PRESS_MS = 380;
  const startPress = (idx, e) => {
    // Right-click also opens selection at this line — power-user shortcut.
    if (e && e.button === 2) return; // handled by onContextMenu
    pressedRef.current = { idx, t0: Date.now(), fired: false };
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
      if (pressedRef.current && !pressedRef.current.fired) {
        pressedRef.current.fired = true;
        onSelectStart?.(idx);
      }
    }, LONG_PRESS_MS);
  };
  const endPress = (idx) => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    // If the long-press fired, the click is consumed by selection mode —
    // don't seek. If it didn't fire, this is a normal click.
    if (pressedRef.current?.fired) {
      pressedRef.current = null;
      return;
    }
    pressedRef.current = null;
    if (selecting) {
      // In selection mode, taps extend/contract the highlight rather than seeking.
      onSelectLine?.(idx);
    } else {
      onSeek?.(lines[idx]?.time);
    }
  };
  const cancelPress = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    pressedRef.current = null;
  };

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        overflow: selecting ? 'auto' : 'hidden',
        scrollbarWidth: 'none',
        position: 'relative',
        maskImage: 'linear-gradient(to bottom, transparent 0%, #000 15%, #000 85%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 15%, #000 85%, transparent 100%)',
      }}
    >
      <div
        style={{
          transform: selecting ? 'none' : `translateY(${offset}px)`,
          transition: selecting ? 'none' : 'transform 0.55s cubic-bezier(0.25, 0.1, 0.25, 1)',
          willChange: selecting ? 'auto' : 'transform',
        }}
      >
        {lines.map((line, i) => {
          const isActive = i === activeIdx;
          const isPast = i < activeIdx;
          const isSelected = selecting && i >= selection.start && i <= selection.end;

          let styleColor;
          let styleOpacity;
          let styleWeight;
          if (isSelected) {
            styleColor = '#fff';
            styleOpacity = 1;
            styleWeight = 600;
          } else if (selecting) {
            // While selecting, fade unselected lines uniformly — past/future
            // distinction doesn't matter, the user is composing a share.
            styleColor = 'rgba(255,255,255,0.32)';
            styleOpacity = 0.85;
            styleWeight = 400;
          } else {
            styleColor = isActive ? '#fff' : isPast ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.45)';
            styleOpacity = isActive ? 1 : isPast ? 0.7 : 0.85;
            styleWeight = isActive ? 700 : 400;
          }

          return (
            <div
              key={`${i}-${line.time}`}
              ref={(el) => { lineRefs.current[i] = el; }}
              onMouseDown={(e) => startPress(i, e)}
              onMouseUp={() => endPress(i)}
              onMouseLeave={cancelPress}
              onTouchStart={() => startPress(i)}
              onTouchEnd={() => endPress(i)}
              onTouchCancel={cancelPress}
              onContextMenu={(e) => { e.preventDefault(); onSelectStart?.(i); }}
              style={{
                position: 'relative',
                padding: '8px 8px 8px 14px',
                fontSize,
                fontWeight: styleWeight,
                lineHeight,
                textAlign: 'left',
                color: styleColor,
                opacity: styleOpacity,
                borderRadius: isSelected ? 8 : 0,
                background: isSelected ? `rgba(${accent},0.18)` : 'transparent',
                textShadow: isActive && !selecting
                  ? `0 0 20px rgba(${accent},0.5), 0 1px 8px rgba(0,0,0,0.3)`
                  : isSelected
                    ? `0 0 18px rgba(${accent},0.35)`
                    : 'none',
                transition: 'color 0.25s ease, opacity 0.25s ease, font-weight 0.25s ease, text-shadow 0.25s ease, background 0.2s ease',
                cursor: 'pointer',
                userSelect: 'none',
                WebkitUserSelect: 'none',
              }}
            >
              {/* Accent bar on the left edge for selected lines — gives the
                  highlight a clean Apple-Music-like marker without depending
                  solely on background colour. */}
              {isSelected ? (
                <span
                  aria-hidden
                  style={{
                    position: 'absolute', left: 2, top: 8, bottom: 8, width: 3,
                    borderRadius: 999,
                    background: `rgb(${accent})`,
                    boxShadow: `0 0 10px rgba(${accent},0.7)`,
                  }}
                />
              ) : null}
              {line.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Plain (unsynced) lyrics — scrollable, left-aligned to match synced style.
 *
 * Supports the same share-selection vocabulary as SyncedLyrics: long-press
 * or right-click a line to enter selection mode, click further lines to
 * extend the range. Blank lines (verse separators) are skipped — selecting
 * them would just be empty space in the share card.
 */
function PlainLyrics({
  text, fontSize = 13, lineHeight = 1.55,
  accent = '128, 128, 128',
  selection = null,
  onSelectLine,
  onSelectStart,
}) {
  if (!text) return null;
  const lines = text.split('\n');
  const selecting = !!selection;

  const pressTimerRef = useRef(null);
  const pressedRef = useRef(null);
  const LONG_PRESS_MS = 380;
  const startPress = (idx, e) => {
    if (e && e.button === 2) return;
    pressedRef.current = { idx, fired: false };
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
      if (pressedRef.current && !pressedRef.current.fired) {
        pressedRef.current.fired = true;
        onSelectStart?.(idx);
      }
    }, LONG_PRESS_MS);
  };
  const endPress = (idx) => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    if (pressedRef.current?.fired) {
      pressedRef.current = null;
      return;
    }
    pressedRef.current = null;
    // Plain lyrics have no seek target, so a quick tap only does anything
    // in selection mode (extend/contract).
    if (selecting) onSelectLine?.(idx);
  };
  const cancelPress = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    pressedRef.current = null;
  };

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      overflowX: 'hidden',
      scrollbarWidth: 'none',
      maskImage: 'linear-gradient(to bottom, transparent 0%, #000 8%, #000 92%, transparent 100%)',
      WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 8%, #000 92%, transparent 100%)',
      padding: '24px 8px',
    }}
    >
      {lines.map((line, i) => {
        const isBlank = !line.trim();
        const isSelected = selecting && !isBlank && i >= selection.start && i <= selection.end;
        const dimmed = selecting && !isSelected && !isBlank;
        return (
          <div
            key={i}
            // Blank lines are non-interactive — selecting whitespace is meaningless.
            onMouseDown={isBlank ? undefined : (e) => startPress(i, e)}
            onMouseUp={isBlank ? undefined : () => endPress(i)}
            onMouseLeave={cancelPress}
            onTouchStart={isBlank ? undefined : () => startPress(i)}
            onTouchEnd={isBlank ? undefined : () => endPress(i)}
            onTouchCancel={cancelPress}
            onContextMenu={isBlank ? undefined : (e) => { e.preventDefault(); onSelectStart?.(i); }}
            style={{
              position: 'relative',
              padding: '4px 8px 4px 14px',
              fontSize,
              fontWeight: isSelected ? 600 : 400,
              lineHeight,
              textAlign: 'left',
              color: isBlank
                ? 'transparent'
                : isSelected
                  ? '#fff'
                  : dimmed
                    ? 'rgba(255,255,255,0.3)'
                    : 'rgba(255,255,255,0.55)',
              background: isSelected ? `rgba(${accent},0.18)` : 'transparent',
              borderRadius: isSelected ? 8 : 0,
              minHeight: isBlank ? 10 : undefined,
              cursor: isBlank ? 'default' : 'pointer',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              transition: 'color 0.2s, background 0.2s, font-weight 0.2s',
            }}
          >
            {isSelected ? (
              <span
                aria-hidden
                style={{
                  position: 'absolute', left: 2, top: 4, bottom: 4, width: 3,
                  borderRadius: 999,
                  background: `rgb(${accent})`,
                  boxShadow: `0 0 10px rgba(${accent},0.7)`,
                }}
              />
            ) : null}
            {line.trim() || '\u00A0'}
          </div>
        );
      })}
    </div>
  );
}

export { LyricsEditor, SyncedLyrics, PlainLyrics };
