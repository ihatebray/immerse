import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

const EXPLORE_CSS = `
  .xp-scroll * { box-sizing: border-box; }
  .xp-scroll::-webkit-scrollbar { width: 10px; }
  .xp-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.13); border-radius: 5px; border: 3px solid transparent; background-clip: content-box; }
  .xp-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.24); background-clip: content-box; }

  @keyframes xp-drift-a { 0%,100%{transform:translate3d(0,0,0) scale(1)} 33%{transform:translate3d(6%,4%,0) scale(1.08)} 66%{transform:translate3d(-4%,2%,0) scale(1.04)} }
  @keyframes xp-drift-b { 0%,100%{transform:translate3d(0,0,0) scale(1.05)} 50%{transform:translate3d(-7%,-5%,0) scale(1)} }
  @keyframes xp-breathe { 0%,100%{opacity:.42; transform:scale(1)} 50%{opacity:.52; transform:scale(1.05)} }
  .xp-field-a { animation: xp-drift-a 30s ease-in-out infinite; will-change: transform; }
  .xp-field-b { animation: xp-drift-b 38s ease-in-out infinite; will-change: transform; }
  .xp-bleed { animation: xp-breathe 24s ease-in-out infinite; will-change: opacity, transform; }
  @keyframes xp-in { 0%{opacity:0; transform:translateY(14px)} 100%{opacity:1; transform:translateY(0)} }
  @keyframes xp-tile-in { 0%{opacity:0; transform:translateY(16px) scale(.97)} 100%{opacity:1; transform:translateY(0) scale(1)} }
  @keyframes xp-spin { to { transform: rotate(360deg); } }
  .xp-spin { transform-origin: 12px 12px; animation: xp-spin .9s linear infinite; }

  .xp-sec { animation: xp-in .6s cubic-bezier(0.16,1,0.3,1) both; }
  .xp-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; flex-shrink: 0; }

  .xp-head { margin-bottom: 30px; display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
  .xp-head-left { min-width: 0; }
  .xp-greeting { display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase; color: rgba(255,255,255,0.5); margin-bottom: 8px; }
  .xp-wordmark { font-size: clamp(30px, 4vw, 40px); font-weight: 300; letter-spacing: -0.02em; line-height: 1; color: #fff; }
  .xp-tag { display: block; font-size: 13px; color: rgba(255,255,255,0.45); margin-top: 9px; letter-spacing: 0.01em; }

  /* Start listening — soft outlined chip with squared accent icon */
  .xp-start { display: inline-flex; align-items: center; gap: 12px; cursor: pointer; border: 1px solid rgba(255,255,255,0.16); border-radius: 14px; padding: 10px 18px 10px 12px;
    background: rgba(255,255,255,0.03); font: inherit; color: #fff;
    transition: background .18s, border-color .18s, transform .18s cubic-bezier(0.16,1,0.3,1); flex-shrink: 0; }
  .xp-start:hover { background: rgba(var(--acc),0.14); border-color: rgba(var(--acc),0.5); transform: translateY(-2px); }
  .xp-start-ico { width: 40px; height: 40px; flex-shrink: 0; border-radius: 11px; background: rgb(var(--acc)); color: #fff; display: flex; align-items: center; justify-content: center; padding-left: 2px; }
  .xp-start-tx { display: flex; flex-direction: column; align-items: flex-start; }
  .xp-start-t { font-size: 14px; font-weight: 700; color: #fff; }
  .xp-start-s { font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 1px; }

  .xp-label { display: flex; align-items: center; gap: 9px; font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.55); margin-bottom: 14px; }

  /* Hero */
  .xp-hero { position: relative; overflow: hidden; display: flex; align-items: center; gap: 20px; padding: 18px; border-radius: 20px; cursor: pointer; max-width: 720px;
    background: rgba(18,18,20,0.6); backdrop-filter: blur(30px) saturate(1.6); -webkit-backdrop-filter: blur(30px) saturate(1.6);
    border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 22px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05);
    transition: transform .3s cubic-bezier(0.16,1,0.3,1), box-shadow .3s; }
  .xp-hero:hover { transform: translateY(-3px); box-shadow: 0 28px 70px rgba(0,0,0,0.6); }
  .xp-hero-wash { position: absolute; inset: 0; pointer-events: none; }
  .xp-hero-cov { position: relative; z-index: 1; width: clamp(96px,12vw,124px); height: clamp(96px,12vw,124px); border-radius: 13px; background-size: cover; background-position: center; background-color: rgba(0,0,0,0.4); flex-shrink: 0; box-shadow: 0 12px 32px rgba(0,0,0,0.5); }
  .xp-hero-meta { position: relative; z-index: 1; flex: 1; min-width: 0; }
  .xp-hero-t { font-size: clamp(20px,2.6vw,26px); font-weight: 700; color: #fff; line-height: 1.1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .xp-hero-a { font-size: 14px; color: rgba(255,255,255,0.62); margin-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .xp-hero-play { position: relative; z-index: 1; flex-shrink: 0; width: 54px; height: 54px; border-radius: 50%; background: #fff; color: #000; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 22px rgba(0,0,0,0.4); transition: transform .18s cubic-bezier(0.34,1.56,0.64,1); }
  .xp-hero-play:hover { transform: scale(1.08); }

  /* ===== Combined "For you" grid — favorites + rediscovery ===== */
  .xp-foryou { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: clamp(14px, 1.6vw, 20px); max-width: 1000px; }
  @media (max-width: 760px) { .xp-foryou { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  .xp-fy { cursor: pointer; display: flex; flex-direction: column; gap: 9px; animation: xp-tile-in .5s cubic-bezier(0.16,1,0.3,1) both; }
  .xp-fy-cov { position: relative; width: 100%; aspect-ratio: 1; border-radius: 13px; background-size: cover; background-position: center; background-color: rgba(0,0,0,0.4); box-shadow: 0 12px 32px rgba(0,0,0,0.5); transition: transform .26s cubic-bezier(0.16,1,0.3,1), box-shadow .26s; }
  .xp-fy:hover .xp-fy-cov { transform: translateY(-5px); box-shadow: 0 22px 52px rgba(0,0,0,0.62); }
  .xp-fy-play { position: absolute; bottom: 10px; right: 10px; width: 40px; height: 40px; border-radius: 50%; background: rgba(255,255,255,0.96); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 22px rgba(0,0,0,0.5); opacity: 0; transform: translateY(6px) scale(0.85); transition: opacity .2s, transform .2s cubic-bezier(0.34,1.56,0.64,1); }
  .xp-fy:hover .xp-fy-play { opacity: 1; transform: translateY(0) scale(1); }
  .xp-fy-play:hover { transform: scale(1.09); }
  .xp-fy-go { position: absolute; top: 10px; right: 10px; width: 30px; height: 30px; border-radius: 50%; background: rgba(255,255,255,0.9); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.45); opacity: 0; transform: scale(0.8); transition: opacity .2s, transform .2s; }
  .xp-fy:hover .xp-fy-go { opacity: 1; transform: scale(1); }
  .xp-fy-go:hover { transform: scale(1.1); background: #fff; }
  .xp-fy-reason { align-self: flex-start; font-size: 8.5px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; padding: 2px 7px; border-radius: 100px; }
  .xp-fy-reason.favorite { color: #fff; background: rgba(var(--acc),0.95); }
  .xp-fy-reason.rediscover { color: rgba(255,255,255,0.7); border: 1px solid rgba(255,255,255,0.25); }
  .xp-fy-t { font-size: 12.5px; font-weight: 600; color: rgba(255,255,255,0.92); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; }
  .xp-fy-a { font-size: 11px; color: rgba(255,255,255,0.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; margin-top: -3px; }

  /* Top songs list */
  .xp-chart-list { display: flex; flex-direction: column; gap: 4px; max-width: 720px; }
  .xp-song { display: flex; align-items: center; gap: 14px; padding: 8px 12px; border-radius: 12px; transition: background .14s; animation: xp-in .5s cubic-bezier(0.16,1,0.3,1) both; }
  .xp-song:hover { background: rgba(255,255,255,0.05); }
  .xp-rank { width: 22px; text-align: center; font-size: 13px; font-weight: 700; color: rgba(255,255,255,0.4); font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .xp-song-cov { width: 46px; height: 46px; border-radius: 8px; background-size: cover; background-position: center; background-color: rgba(0,0,0,0.4); flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
  .xp-song-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .xp-song-t { font-size: 14px; font-weight: 600; color: rgba(255,255,255,0.92); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .xp-song-a { font-size: 11.5px; color: rgba(255,255,255,0.5); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .xp-dl { width: 32px; height: 32px; flex-shrink: 0; border-radius: 50%; background: rgba(255,255,255,0.08); border: none; color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background .15s; }
  .xp-dl:hover { background: rgba(var(--acc),0.85); }
  .xp-dl.queued { background: rgba(var(--acc),0.5); cursor: default; }
  .xp-dl.done { background: rgba(80,200,120,0.85); cursor: default; }
  .xp-dl.failed { background: rgba(220,80,80,0.7); }

  /* Horizontal cover rows */
  .xp-row { display: flex; gap: 16px; overflow-x: auto; padding-bottom: 12px; padding-top: 2px; }
  .xp-row::-webkit-scrollbar { height: 8px; }
  .xp-row::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 4px; }
  .xp-tile { flex-shrink: 0; width: 150px; padding: 0; background: none; border: none; cursor: pointer; display: flex; flex-direction: column; gap: 9px; text-align: left; animation: xp-tile-in .55s cubic-bezier(0.16,1,0.3,1) both; }
  .xp-tile-cov { width: 150px; height: 150px; border-radius: 12px; background-size: cover; background-position: center; background-color: rgba(0,0,0,0.4); position: relative; box-shadow: 0 12px 32px rgba(0,0,0,0.5); transition: transform .25s cubic-bezier(0.16,1,0.3,1), box-shadow .25s; }
  .xp-tile:hover .xp-tile-cov { transform: translateY(-4px); }
  .xp-tile.open .xp-tile-cov { box-shadow: 0 16px 40px rgba(0,0,0,0.6), 0 0 0 2px rgba(var(--acc),0.95); }
  .xp-tile-badge { position: absolute; top: 9px; left: 9px; background: rgba(0,0,0,0.62); border: 1px solid rgba(var(--acc),0.95); color: #fff; font-size: 8px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; padding: 3px 7px; border-radius: 100px; backdrop-filter: blur(4px); }
  .xp-tile-chev, .xp-tile-play { position: absolute; bottom: 10px; right: 10px; width: 32px; height: 32px; border-radius: 50%; background: #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.45); opacity: 0; transform: translateY(6px); transition: opacity .2s, transform .2s; }
  .xp-tile:hover .xp-tile-chev, .xp-tile:hover .xp-tile-play, .xp-tile.open .xp-tile-chev { opacity: 1; transform: translateY(0); }
  .xp-tile-t { font-size: 12.5px; font-weight: 600; color: rgba(255,255,255,0.92); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; padding: 0 2px; }
  .xp-tile-a { font-size: 11px; color: rgba(255,255,255,0.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; padding: 0 2px; margin-top: -4px; }

  /* Album expand panel */
  @keyframes xp-ap-in { 0%{opacity:0; transform:translateY(-6px); max-height:0} 100%{opacity:1; transform:translateY(0); max-height:380px} }
  .xp-album-panel { margin-top: 10px; max-width: 760px; border-radius: 16px; overflow: hidden;
    background: rgba(14,14,16,0.66); backdrop-filter: blur(28px) saturate(1.5); -webkit-backdrop-filter: blur(28px) saturate(1.5);
    border: 1px solid rgba(255,255,255,0.09); box-shadow: 0 22px 56px rgba(0,0,0,0.55), 0 0 0 1px rgba(var(--acc),0.14);
    animation: xp-ap-in .34s cubic-bezier(0.16,1,0.3,1) both; }
  .xp-ap-head { display: flex; align-items: center; gap: 14px; padding: 15px; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .xp-ap-art { width: 60px; height: 60px; border-radius: 10px; background-size: cover; background-position: center; flex-shrink: 0; box-shadow: 0 6px 16px rgba(0,0,0,0.5); }
  .xp-ap-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .xp-ap-t { font-size: 15px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .xp-ap-s { font-size: 12px; color: rgba(255,255,255,0.6); margin-top: 2px; }
  .xp-ap-d { font-size: 10.5px; color: rgba(255,255,255,0.4); margin-top: 4px; }
  .xp-ap-all { display: inline-flex; align-items: center; gap: 7px; background: rgba(var(--acc),0.88); border: 1px solid rgba(var(--acc),1); color: #fff; cursor: pointer; padding: 9px 14px; border-radius: 10px; font-size: 12px; font-weight: 700; white-space: nowrap; transition: filter .15s; }
  .xp-ap-all:hover { filter: brightness(1.15); }
  .xp-ap-x { width: 34px; height: 34px; flex-shrink: 0; border-radius: 9px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.7); cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .xp-ap-x:hover { background: rgba(255,255,255,0.12); }
  .xp-ap-tracks { max-height: 280px; overflow-y: auto; padding: 6px; }
  .xp-ap-tracks::-webkit-scrollbar { width: 8px; }
  .xp-ap-tracks::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 4px; border: 2px solid transparent; background-clip: content-box; }
  .xp-ap-row { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border-radius: 8px; transition: background .12s; }
  .xp-ap-row:hover { background: rgba(255,255,255,0.05); }
  .xp-ap-n { width: 20px; text-align: right; font-size: 11.5px; color: rgba(255,255,255,0.4); font-variant-numeric: tabular-nums; }
  .xp-ap-tn { flex: 1; min-width: 0; font-size: 13px; color: rgba(255,255,255,0.9); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .xp-ap-e { font-size: 8px; font-weight: 800; border: 1px solid rgba(255,255,255,0.28); border-radius: 3px; padding: 1px 4px; color: rgba(255,255,255,0.7); }
  .xp-ap-dur { font-size: 11.5px; color: rgba(255,255,255,0.4); font-variant-numeric: tabular-nums; }

  /* Skeletons */
  @keyframes xp-shim { 0%{opacity:.4} 50%{opacity:.7} 100%{opacity:.4} }
  .xp-skel-row { height: 62px; border-radius: 12px; background: rgba(255,255,255,0.05); animation: xp-shim 1.4s ease-in-out infinite; max-width: 720px; }
  .xp-skel-tile { flex-shrink: 0; width: 150px; height: 188px; border-radius: 12px; background: rgba(255,255,255,0.05); animation: xp-shim 1.4s ease-in-out infinite; }

  .xp-msg { font-size: 13px; color: rgba(255,255,255,0.5); padding: 14px 2px; }

  /* New releases — full list with inline expand */
  .xp-rel-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 18px; max-width: 980px; align-items: start; }
  @media (max-width: 760px) { .xp-rel-list { grid-template-columns: 1fr; } }
  .xp-rel { border-radius: 12px; overflow: hidden; }
  .xp-rel.open { background: rgba(255,255,255,0.03); grid-column: 1 / -1; }
  .xp-rel-row { display: flex; align-items: center; gap: 14px; width: 100%; padding: 9px 12px; border-radius: 12px; background: none; border: none; cursor: pointer; text-align: left; transition: background .14s; animation: xp-in .45s cubic-bezier(0.16,1,0.3,1) both; }
  .xp-rel-row:hover { background: rgba(255,255,255,0.05); }
  .xp-rel-cov { width: 52px; height: 52px; flex-shrink: 0; border-radius: 9px; background-size: cover; background-position: center; background-color: rgba(0,0,0,0.4); box-shadow: 0 5px 14px rgba(0,0,0,0.4); }
  .xp-rel-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .xp-rel-t { font-size: 14.5px; font-weight: 600; color: rgba(255,255,255,0.95); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 9px; }
  .xp-rel-tag { font-size: 8.5px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.6); border: 1px solid rgba(255,255,255,0.28); border-radius: 4px; padding: 1px 5px; flex-shrink: 0; }
  .xp-rel-tag.single { color: #fff; background: rgba(var(--acc),0.95); border-color: rgba(var(--acc),1); }
  .xp-rel-a { font-size: 12px; color: rgba(255,255,255,0.5); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .xp-rel-act { width: 36px; height: 36px; flex-shrink: 0; border-radius: 50%; background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.85); display: flex; align-items: center; justify-content: center; transition: background .15s, color .15s; }
  .xp-rel-row:hover .xp-rel-act { background: rgba(var(--acc),0.85); color: #fff; }
  .xp-rel-act.queued { background: rgba(var(--acc),0.5); }
  .xp-rel-act.done { background: rgba(80,200,120,0.85); color: #fff; }
  .xp-rel-act.failed { background: rgba(220,80,80,0.7); color: #fff; }
  @keyframes xp-relpanel-in { 0%{opacity:0; transform:translateY(-4px)} 100%{opacity:1; transform:translateY(0)} }
  .xp-rel-panel { padding: 4px 12px 12px 78px; animation: xp-relpanel-in .28s cubic-bezier(0.16,1,0.3,1) both; }
  .xp-rel-panel-bar { display: flex; align-items: center; gap: 14px; margin-bottom: 6px; }
  .xp-rel-genre { font-size: 10.5px; color: rgba(255,255,255,0.4); letter-spacing: 0.04em; text-transform: uppercase; }

  /* Top songs — 2-column grid (wraps into 2 rows of 5 at default 10) */
  .xp-song-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 22px; max-width: 980px; }
  .xp-viewmore { margin-top: 14px; display: inline-flex; align-items: center; gap: 7px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); color: rgba(255,255,255,0.8); cursor: pointer; padding: 9px 16px; border-radius: 100px; font: inherit; font-size: 11.5px; font-weight: 700; letter-spacing: 0.02em; transition: background .15s, border-color .15s; }
  .xp-viewmore:hover { background: rgba(var(--acc),0.2); border-color: rgba(var(--acc),0.5); color: #fff; }

  /* New releases — wrapping mosaic with a featured first tile */
  .xp-mosaic { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); grid-auto-rows: 120px; gap: 12px; max-width: 980px; }
  .xp-mtile { position: relative; border: none; padding: 0; cursor: pointer; border-radius: 14px; overflow: hidden; background-size: cover; background-position: center; background-color: rgba(0,0,0,0.4); box-shadow: 0 12px 32px rgba(0,0,0,0.5); animation: xp-tile-in .55s cubic-bezier(0.16,1,0.3,1) both; transition: transform .28s cubic-bezier(0.16,1,0.3,1), box-shadow .28s; }
  .xp-mtile.feat { grid-column: span 2; grid-row: span 2; }
  .xp-mtile:hover { transform: translateY(-4px) scale(1.012); box-shadow: 0 22px 56px rgba(0,0,0,0.65); z-index: 4; }
  .xp-mtile.open { box-shadow: 0 18px 46px rgba(0,0,0,0.65), 0 0 0 2px rgba(var(--acc),0.95); }
  .xp-mtile-badge { position: absolute; top: 9px; left: 9px; background: rgba(0,0,0,0.62); border: 1px solid rgba(var(--acc),0.95); color: #fff; font-size: 8px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; padding: 3px 7px; border-radius: 100px; backdrop-filter: blur(4px); z-index: 2; }
  .xp-mtile-scrim { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; padding: 12px; text-align: left; background: linear-gradient(180deg, transparent 45%, rgba(0,0,0,0.82) 100%); opacity: 0; transition: opacity .25s; }
  .xp-mtile:hover .xp-mtile-scrim, .xp-mtile.open .xp-mtile-scrim { opacity: 1; }
  .xp-mtile-t { font-size: 13px; font-weight: 700; color: #fff; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .xp-mtile.feat .xp-mtile-t { font-size: 16px; white-space: normal; }
  .xp-mtile-a { font-size: 11px; color: rgba(255,255,255,0.7); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .xp-mtile-chev { position: absolute; bottom: 11px; right: 11px; width: 30px; height: 30px; border-radius: 50%; background: #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.45); opacity: 0; transform: translateY(6px); transition: opacity .2s, transform .2s; }
  .xp-mtile:hover .xp-mtile-chev, .xp-mtile.open .xp-mtile-chev { opacity: 1; transform: translateY(0); }
  .xp-skel-mtile { border-radius: 14px; background: rgba(255,255,255,0.05); animation: xp-shim 1.4s ease-in-out infinite; }

  /* Recently played — compact wall of square covers */
  .xp-wall { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 12px; max-width: 980px; }
  .xp-wtile { position: relative; aspect-ratio: 1; border: none; padding: 0; cursor: pointer; border-radius: 12px; overflow: hidden; background-size: cover; background-position: center; background-color: rgba(0,0,0,0.4); box-shadow: 0 10px 26px rgba(0,0,0,0.45); animation: xp-tile-in .5s cubic-bezier(0.16,1,0.3,1) both; transition: transform .25s cubic-bezier(0.16,1,0.3,1), box-shadow .25s; }
  .xp-wtile:hover { transform: translateY(-4px) scale(1.02); box-shadow: 0 18px 44px rgba(0,0,0,0.6); z-index: 4; }
  .xp-wtile-scrim { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; padding: 9px; text-align: left; background: linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.85) 100%); opacity: 0; transition: opacity .22s; }
  .xp-wtile:hover .xp-wtile-scrim { opacity: 1; }
  .xp-wtile-t { font-size: 11px; font-weight: 700; color: #fff; line-height: 1.15; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .xp-wtile-a { font-size: 9.5px; color: rgba(255,255,255,0.65); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .xp-wtile-play { position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; border-radius: 50%; background: #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.45); opacity: 0; transform: scale(0.7); transition: opacity .2s, transform .2s; }
  .xp-wtile:hover .xp-wtile-play { opacity: 1; transform: scale(1); }

  .xp-stats { display: flex; gap: 16px; margin-top: 26px; font-size: 11.5px; color: rgba(255,255,255,0.34); font-variant-numeric: tabular-nums; }
  .xp-stats b { color: rgba(255,255,255,0.55); font-weight: 700; }
  .xp-stats .sep { opacity: 0.3; }

  .xp-pill-primary { background: rgba(var(--acc),0.55); border: 1px solid rgba(var(--acc),0.7); color: #fff; cursor: pointer; padding: 9px 18px; border-radius: 10px; font: inherit; font-size: 11.5px; font-weight: 700; transition: background .15s; }
  .xp-pill-primary:hover { background: rgba(var(--acc),0.7); }
  .xp-pill-ghost { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14); color: rgba(255,255,255,0.85); cursor: pointer; padding: 9px 18px; border-radius: 10px; font: inherit; font-size: 11.5px; font-weight: 700; transition: background .15s; }
  .xp-pill-ghost:hover { background: rgba(255,255,255,0.12); }

  @media (prefers-reduced-motion: reduce) {
    .xp-field-a, .xp-field-b, .xp-bleed, .xp-spin, .xp-skel-row, .xp-skel-tile, .xp-skel-mtile { animation: none; }
    .xp-sec, .xp-song, .xp-tile, .xp-mtile, .xp-wtile, .xp-album-panel, .xp-fy { animation: none; }
  }
`;

function WelcomeScreen({
  library,
  playlists,
  onImportFiles,
  onImportFolder,
  importing,
  onOpenLibrary,
  onOpenAlbumInLibrary,
  onOpenFind,
  onOpenNew,
  onNewPlaylist,
  onPlayTrack,
  accent = '48, 48, 48',
  onSpotifyImportDone,
  followedReleases = [],
  trackOfMomentEnabled = false,
  playEvents = [],
}) {
  const isEmpty = library.length === 0;

  // Derive simple library stats — albums are unique album+primary-artist pairs
  const albumCount = useMemo(() => {
    if (isEmpty) return 0;
    const primaryArtist = (str) => {
      if (!str) return '';
      return str.split(/,|feat\.|ft\.|&|\bx\b/i)[0].trim();
    };
    const seen = new Set();
    for (const t of library) {
      const k = `${(t.album || '').trim().toLowerCase()}__${primaryArtist(t.artist).toLowerCase()}`;
      seen.add(k);
    }
    return seen.size;
  }, [library, isEmpty]);

  // Recently played — take last N distinct tracks by lastPlayed timestamp.
  // Dedupe by (album + artist) pair so we don't see the same record over and
  // over (5 plays from the same album = 1 tile, not 5).
  const recentTracks = useMemo(() => {
    if (isEmpty) return [];
    const sorted = library
      .filter((t) => t.lastPlayed && t.coverArt)
      .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
    const seen = new Set();
    const result = [];
    for (const t of sorted) {
      const key = `${(t.album || '').toLowerCase()}__${(t.artist || '').toLowerCase().split(/[,&]/)[0].trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(t);
      if (result.length >= 18) break;
    }
    return result;
  }, [library, isEmpty]);

  // ===== "For you" — one combined feed mixing songs you haven't played yet
  // (rediscovery) with your most-played (favorites). Replaces the separate
  // recommended + recently-played columns. Deduped by album+artist so it reads
  // as a varied set, each item tagged with WHY it's here.
  const forYouMix = useMemo(() => {
    if (isEmpty) return [];
    const withArt = library.filter((t) => t.coverArt && (t.title || t.album));
    const primary = (s) => (s || '').toLowerCase().split(/[,&]/)[0].trim();
    const dedupeKey = (t) => `${(t.album || t.title || '').toLowerCase()}__${primary(t.artist)}`;

    // Pool A — never played (playCount 0 / no lastPlayed): rediscovery.
    const unplayed = withArt
      .filter((t) => !(Number(t.playCount) > 0) && !(Number(t.lastPlayed) > 0))
      .sort(() => Math.random() - 0.5); // shuffle so it varies each open

    // Pool B — most played: favorites.
    const mostPlayed = withArt
      .filter((t) => Number(t.playCount) > 0)
      .sort((a, b) => (Number(b.playCount) || 0) - (Number(a.playCount) || 0));

    // Top row = 5 favorites, bottom row = 5 rediscovery. Dedupe by album+artist
    // across both so a track can't appear twice.
    const seen = new Set();
    const take = (pool, reason, n) => {
      const picked = [];
      for (const t of pool) {
        if (picked.length >= n) break;
        const k = dedupeKey(t);
        if (seen.has(k)) continue;
        seen.add(k);
        picked.push({ t, reason });
      }
      return picked;
    };
    const favs = take(mostPlayed, 'favorite', 5);
    const fresh = take(unplayed, 'rediscover', 5);
    return [...favs, ...fresh];
  }, [library, isEmpty]);
  // Fetched from the main process (Apple's public marketing-tools RSS, US).
  // We keep songs + new-release albums. The home leads with the user's own
  // recommendation, then opens outward into these.
  const [charts, setCharts] = useState({ songs: [], albums: [] });
  const [chartsLoading, setChartsLoading] = useState(true);
  const [chartsError, setChartsError] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.fetchCharts) { setChartsLoading(false); setChartsError('unavailable'); return undefined; }
    setChartsLoading(true);
    Promise.resolve(api.fetchCharts())
      .then((res) => {
        if (cancelled) return;
        if (res?.ok) {
          setCharts({ songs: res.songs || [], albums: res.albums || [] });
          setChartsError(null);
        } else {
          setChartsError(res?.error || 'failed');
        }
      })
      .catch((e) => { if (!cancelled) setChartsError(String(e?.message || e)); })
      .finally(() => { if (!cancelled) setChartsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Download state per chart item, keyed by a stable id. Values:
  // 'queued' | 'done' | 'failed'.
  const [dlState, setDlState] = useState({});
  const setDl = useCallback((key, v) => setDlState((m) => ({ ...m, [key]: v })), []);

  // Download a single chart SONG: look it up by store id for full metadata,
  // then route through the existing yt-dlp importer.
  const downloadChartSong = useCallback(async (song) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.lookupChartSong || !api?.importFromYoutubeSearch) return;
    const key = `song:${song.id}`;
    if (dlState[key] === 'queued' || dlState[key] === 'done') return;
    setDl(key, 'queued');
    try {
      const look = await api.lookupChartSong(song.id);
      const tk = look?.ok ? look.track : null;
      const meta = tk ? {
        title: tk.trackName, artists: tk.artistName, album: tk.collectionName,
        albumArtUrl: tk.artworkUrl || song.artworkUrl, durationMs: tk.trackTimeMillis || 0,
        spotifyId: `itunes:${tk.trackId}`, trackNumber: tk.trackNumber || null, discNumber: null,
        explicit: tk.explicit,
      } : {
        // Fallback: download from feed fields if lookup failed.
        title: song.name, artists: song.artistName, album: '', albumArtUrl: song.artworkUrl,
        durationMs: 0, spotifyId: `itunes:${song.id}`, trackNumber: null, discNumber: null, explicit: null,
      };
      const res = await api.importFromYoutubeSearch(meta);
      if (res?.ok && res.track) { onSpotifyImportDone?.(res.track); setDl(key, 'done'); }
      else setDl(key, 'failed');
    } catch { setDl(key, 'failed'); }
  }, [dlState, setDl, onSpotifyImportDone]);

  // ---- Chart ALBUM expand + download (mirrors the releases pattern) ----
  const [expandedAlbumId, setExpandedAlbumId] = useState(null);

  // New releases from FOLLOWED ARTISTS (the app's release tracker), replacing
  // the dead Apple "new-releases" feed. Dedupe explicit/clean/edition variants
  // (keep explicit), merge collabs under related artists, drop future-dated
  // pre-orders. Shaped to match the chart-album item the mosaic expects:
  // { id, name, artistName, artworkUrl, releaseDate, genre, itemType }.
  const followedNewReleases = useMemo(() => {
    if (!Array.isArray(followedReleases) || followedReleases.length === 0) return [];
    const now = Date.now();
    const normName = (s) => (s || '').toLowerCase()
      .replace(/\s*[([][^)\]]*(explicit|clean|deluxe|edition|version|remaster[^)\]]*)[^)\]]*[)\]]/gi, '')
      .replace(/\s*-\s*(single|ep|explicit|clean)\s*$/gi, '').replace(/\s+/g, ' ').trim();
    const primaryArtist = (s) => (s || '').toLowerCase().split(/,|feat\.|ft\.|&|\bx\b/i)[0].trim();
    const exRank = (r) => { const e = String(r?.collectionExplicitness || '').toLowerCase(); return e === 'explicit' ? 2 : (e === 'cleaned' || e === 'notexplicit') ? 0 : 1; };
    const byId = new Map();
    const noId = [];
    for (const r of followedReleases) {
      if (!r) continue;
      const ms = Date.parse(r.releaseDate || '') || 0;
      if (ms && ms > now + 12 * 60 * 60 * 1000) continue;
      const id = Number(r.collectionId);
      if (Number.isFinite(id) && id > 0) {
        const p = byId.get(id);
        if (!p || exRank(r) > exRank(p)) byId.set(id, r);
      } else noId.push(r);
    }
    const titleGroups = new Map();
    for (const r of [...byId.values(), ...noId]) {
      const nm = normName(r.collectionName); if (!nm) continue;
      const arr = titleGroups.get(nm) || [];
      const ra = primaryArtist(r.artistName); const full = (r.artistName || '').toLowerCase();
      let into = null;
      for (const ex of arr) { const ea = primaryArtist(ex.artistName); const ef = (ex.artistName || '').toLowerCase(); if (ra === ea || full.includes(ea) || ef.includes(ra)) { into = ex; break; } }
      if (!into) { arr.push(r); titleGroups.set(nm, arr); continue; }
      const better = exRank(r) > exRank(into) ? r : exRank(r) < exRank(into) ? into : ((Date.parse(r.releaseDate || '') || 0) > (Date.parse(into.releaseDate || '') || 0) ? r : into);
      arr[arr.indexOf(into)] = better;
    }
    const out = [];
    for (const arr of titleGroups.values()) out.push(...arr);
    return out
      .sort((a, b) => (Date.parse(b.releaseDate || '') || 0) - (Date.parse(a.releaseDate || '') || 0))
      .map((r) => ({
        id: Number(r.collectionId),
        name: r.collectionName || '',
        artistName: r.artistName || '',
        artworkUrl: r.artworkUrl || '',
        releaseDate: r.releaseDate || '',
        genre: r.primaryGenreName || '',
        itemType: (Number(r.trackCount) === 1) ? 'single' : 'album',
      }));
  }, [followedReleases]);
  const [songsExpanded, setSongsExpanded] = useState(false);
  const [albumTracksCache, setAlbumTracksCache] = useState({}); // {id: track[]}
  const [albumLoading, setAlbumLoading] = useState({});
  const [albumError, setAlbumError] = useState({});

  const toggleAlbum = useCallback((album) => {
    const id = Number(album?.id);
    if (!Number.isFinite(id)) return;
    setExpandedAlbumId((cur) => (cur === id ? null : id));
    if (albumTracksCache[id] || albumLoading[id]) return;
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.lookupReleaseAlbumTracks) { setAlbumError((m) => ({ ...m, [id]: 'unavailable' })); return; }
    setAlbumLoading((m) => ({ ...m, [id]: true }));
    Promise.resolve(api.lookupReleaseAlbumTracks(id))
      .then((res) => {
        if (res?.ok && Array.isArray(res.tracks)) setAlbumTracksCache((m) => ({ ...m, [id]: res.tracks }));
        else setAlbumError((m) => ({ ...m, [id]: res?.error || 'Could not load tracks' }));
      })
      .catch((e) => setAlbumError((m) => ({ ...m, [id]: String(e?.message || e) })))
      .finally(() => setAlbumLoading((m) => ({ ...m, [id]: false })));
  }, [albumTracksCache, albumLoading]);

  const downloadAlbumTrack = useCallback(async (album, tk) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.importFromYoutubeSearch) return;
    const key = `atrk:${album.id}:${tk.trackId}`;
    if (dlState[key] === 'queued' || dlState[key] === 'done') return;
    setDl(key, 'queued');
    try {
      const res = await api.importFromYoutubeSearch({
        title: tk.trackName, artists: tk.artistName || album.artistName, album: tk.collectionName || album.name,
        albumArtUrl: tk.artworkUrl || album.artworkUrl, durationMs: tk.trackTimeMillis || 0,
        spotifyId: `itunes:${tk.trackId}`, trackNumber: tk.trackNumber || null, discNumber: null, explicit: tk.explicit,
      });
      if (res?.ok && res.track) { onSpotifyImportDone?.(res.track); setDl(key, 'done'); }
      else setDl(key, 'failed');
    } catch { setDl(key, 'failed'); }
  }, [dlState, setDl, onSpotifyImportDone]);

  const downloadWholeAlbum = useCallback(async (album) => {
    const tracks = albumTracksCache[Number(album.id)];
    if (!Array.isArray(tracks) || !tracks.length) return;
    for (const tk of tracks) {
      // eslint-disable-next-line no-await-in-loop
      await downloadAlbumTrack(album, tk);
    }
  }, [albumTracksCache, downloadAlbumTrack]);

  // Time-of-day greeting for the hero read-line.
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return 'Late night';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    if (h < 22) return 'Good evening';
    return 'Winding down';
  }, []);

  // Scroll container ref (used for the explore feed).
  const scrollRef = useRef(null);

  // Hero pick — "what's worth playing right now"
  // Strategy:
  //   1. If the user has stuff they HAVEN'T played in 3+ weeks, prefer that
  //      (pull from the back of the library, encourages rediscovery)
  //   2. Otherwise, pick from anything they haven't played yet at all
  //   3. Fallback: random library entry
  // We pick a track but treat it as "an album" — clicking the hero plays the
  // whole album sorted by track number.
  const heroPick = useMemo(() => {
    if (isEmpty) return null;
    const now = Date.now();
    const threeWeeks = 1000 * 60 * 60 * 24 * 21;
    const candidates = library.filter((t) => t.coverArt && (t.album || '').trim());
    if (candidates.length === 0) return null;
    // Prefer "haven't played in 3 weeks" first
    const stale = candidates.filter((t) => {
      const last = t.lastPlayed || 0;
      return last === 0 || (now - last) > threeWeeks;
    });
    const pool = stale.length > 0 ? stale : candidates;
    // Stable per-session pick — uses today's date as a seed so the pick
    // doesn't change every render but DOES change day-to-day.
    const dayKey = new Date().toDateString();
    let h = 0;
    for (let i = 0; i < dayKey.length; i++) h = (h * 31 + dayKey.charCodeAt(i)) | 0;
    const idx = Math.abs(h) % pool.length;
    return pool[idx];
  }, [library, isEmpty]);

  // Album-mate tracks for the hero pick — used so clicking play queues the
  // whole album in track order, not just the single track.
  const heroAlbumTracks = useMemo(() => {
    if (!heroPick) return [];
    const albumKey = (heroPick.album || '').toLowerCase().trim();
    const artistKey = (heroPick.artist || '').toLowerCase().split(/[,&]/)[0].trim();
    const tracks = library.filter((t) => {
      const ta = (t.album || '').toLowerCase().trim();
      const tar = (t.artist || '').toLowerCase().split(/[,&]/)[0].trim();
      return ta === albumKey && tar === artistKey;
    });
    return tracks.sort((a, b) => {
      const an = a.trackNumber || 0;
      const bn = b.trackNumber || 0;
      if (an !== bn) return an - bn;
      return (a.title || '').localeCompare(b.title || '');
    });
  }, [heroPick, library]);

  /* ---------- Track of the moment ----------
   *
   * Picks one track from the library based on:
   *   - Time-of-day match: tracks whose past plays cluster around the
   *     current hour score higher
   *   - Day-of-week match: same for current weekday
   *   - Recency penalty: tracks played in the last 24h get scored down
   *     so we don't suggest what the user just heard
   *   - Familiarity floor: never-played tracks are excluded (the
   *     first-time-hearing sparkle covers those)
   *
   * The selection is stable inside a 4-hour window and refreshes as that
   * window rolls over. Without a play history we still pick something
   * — falls back to a random familiar track.
   *
   * Returns { track, contextLabel } or null. The context label is a
   * short evocative phrase like "Friday night" or "Thursday morning"
   * derived from the current moment.
   */
  const trackOfMoment = useMemo(() => {
    if (!trackOfMomentEnabled) return null;
    if (!library || library.length === 0) return null;

    const now = new Date();
    const currentHour = now.getHours();
    const currentDow = now.getDay(); // 0..6 (Sun..Sat)

    // Build per-track histograms from the play-event log. Index by id so we
    // can look up scores in O(1) during the main pass.
    const hourHist = new Map();
    const dowHist = new Map();
    if (Array.isArray(playEvents)) {
      for (const ev of playEvents) {
        if (!ev || typeof ev.id !== 'string' || !Number.isFinite(ev.at)) continue;
        const d = new Date(ev.at);
        const h = d.getHours();
        const w = d.getDay();
        const hh = hourHist.get(ev.id) || new Array(24).fill(0);
        hh[h] += 1;
        hourHist.set(ev.id, hh);
        const wh = dowHist.get(ev.id) || new Array(7).fill(0);
        wh[w] += 1;
        dowHist.set(ev.id, wh);
      }
    }

    // Score each candidate track. Only consider tracks with cover art and
    // some play history — skipping never-played ones since the sparkle
    // already surfaces those.
    const recencyCutoff = Date.now() - 1000 * 60 * 60 * 24; // 24h
    const candidates = library.filter((t) => (
      t.coverArt && (Number(t.playCount) || 0) > 0
    ));
    if (candidates.length === 0) return null;

    const scored = candidates.map((t) => {
      let score = 1; // baseline so every candidate is reachable

      // Time-of-day score: count plays in current hour ±1 hour, weighted.
      const hh = hourHist.get(t.id);
      if (hh) {
        const cur = hh[currentHour] || 0;
        const prev = hh[(currentHour + 23) % 24] || 0;
        const next = hh[(currentHour + 1) % 24] || 0;
        score += cur * 3 + (prev + next) * 1.5;
      }
      // Day-of-week score: count plays on same weekday.
      const wh = dowHist.get(t.id);
      if (wh) {
        score += (wh[currentDow] || 0) * 2;
      }
      // Recency penalty: heavy if played in last 24h, so we don't repeat
      // what the user just heard. Multiplicative to avoid swamping it.
      const last = Number(t.lastPlayed) || 0;
      if (last && last > recencyCutoff) {
        score *= 0.25;
      }

      return { track: t, score };
    });

    // Stable per-window pick — hash today's date + 4-hour bucket as seed
    // so the chosen track is consistent through the bucket but rolls over.
    const bucketKey = `${now.toDateString()}-${Math.floor(currentHour / 4)}`;
    let h = 0;
    for (let i = 0; i < bucketKey.length; i++) h = (h * 31 + bucketKey.charCodeAt(i)) | 0;

    // Sort by score desc, take top quartile, then deterministically pick
    // one from that quartile via the seed. Avoids always picking the
    // single highest-scoring track (which would be boring) while still
    // keeping the pick within the "best matches" pool.
    scored.sort((a, b) => b.score - a.score);
    const topN = Math.max(1, Math.min(scored.length, Math.ceil(scored.length / 4)));
    const top = scored.slice(0, topN);
    const idx = Math.abs(h) % top.length;
    const picked = top[idx]?.track;
    if (!picked) return null;

    // Build the context label from current time. Keep it short and
    // evocative; aim for the kind of mood a person might describe with
    // ("Friday night", "Saturday morning"). The day-part bucket follows
    // common conversational divisions rather than strict clock hours.
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][currentDow];
    let part = 'evening';
    if (currentHour < 5) part = 'late night';
    else if (currentHour < 11) part = 'morning';
    else if (currentHour < 14) part = 'midday';
    else if (currentHour < 18) part = 'afternoon';
    else if (currentHour < 22) part = 'evening';
    else part = 'night';
    const contextLabel = `${dayName} ${part}`;

    return { track: picked, contextLabel };
  }, [library, playEvents, trackOfMomentEnabled]);

  const handleMomentPlay = () => {
    if (!trackOfMoment || !onPlayTrack) return;
    onPlayTrack(trackOfMoment.track, [trackOfMoment.track]);
  };

  const handleImport = async () => {
    if (typeof onImportFolder === 'function') {
      await onImportFolder();
    } else if (typeof onImportFiles === 'function') {
      await onImportFiles();
    }
  };

  // Build a continuous play queue so playback never dead-ends after one album.
  // Order: the chosen track, then the rest of its album (in track order), then
  // the entire rest of the library shuffled. Passed explicitly so it behaves
  // the same regardless of the global shuffle toggle.
  const shuffleArr = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const albumTracksFor = (track) => {
    const albumKey = (track.album || '').toLowerCase().trim();
    const artistKey = (track.artist || '').toLowerCase().split(/[,&]/)[0].trim();
    if (!albumKey) return [track];
    const at = library
      .filter((t) => {
        const ta = (t.album || '').toLowerCase().trim();
        const tar = (t.artist || '').toLowerCase().split(/[,&]/)[0].trim();
        return ta === albumKey && tar === artistKey;
      })
      .sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));
    return at.length > 0 ? at : [track];
  };
  const playWithLibraryQueue = (track) => {
    if (!onPlayTrack || !track) return;
    const album = albumTracksFor(track);
    const startIdx = Math.max(0, album.findIndex((t) => t.id === track.id));
    // album from the clicked track onward, then the album's earlier tracks,
    // so the clicked song plays first but the album still completes.
    const albumOrdered = [...album.slice(startIdx), ...album.slice(0, startIdx)];
    const albumIds = new Set(album.map((t) => t.id));
    const rest = shuffleArr(library.filter((t) => !albumIds.has(t.id)));
    const queue = [...albumOrdered, ...rest];
    onPlayTrack(queue[0], queue);
  };

  const handleHeroPlay = () => {
    if (!heroPick) return;
    playWithLibraryQueue(heroPick);
  };

  const handleRecentPlay = (track) => {
    playWithLibraryQueue(track);
  };

  // "Start listening" — random song, full library shuffled behind it.
  const handleStartListening = () => {
    if (!onPlayTrack || !library.length) return;
    const shuffled = shuffleArr(library);
    onPlayTrack(shuffled[0], shuffled);
  };

  // ===== EMPTY LIBRARY — focused import call-to-action =====================
  if (isEmpty && charts.songs.length === 0 && charts.albums.length === 0) {
    return (
      <div style={{
        position: 'relative', zIndex: 1, flex: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', padding: '40px 32px',
      }}>
        <style>{EXPLORE_CSS}</style>
        <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          <div className="xp-field" style={{
            position: 'absolute', top: '8%', left: '50%', transform: 'translateX(-50%)',
            width: '70%', height: '70%', borderRadius: '50%',
            background: `radial-gradient(circle, rgba(${accent}, 0.26) 0%, rgba(${accent}, 0) 60%)`, filter: 'blur(70px)',
          }} />
        </div>
        <div style={{
          position: 'relative', zIndex: 1, width: '100%', maxWidth: 400,
          display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
        }}>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 200, letterSpacing: '-0.02em', color: '#fff' }}>Immerse</h1>
          <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Add some music to begin.</div>
          <div style={{ marginTop: 24, display: 'flex', gap: 10 }}>
            <button type="button" onClick={handleImport} disabled={importing} className="xp-pill-primary" style={{ '--acc': accent }}>
              {importing ? 'Importing…' : 'Import music'}
            </button>
            <button type="button" onClick={onOpenFind} className="xp-pill-ghost">Open Find</button>
          </div>
        </div>
      </div>
    );
  }

  const dot = <span className="xp-dot" style={{ background: `rgb(${accent})`, boxShadow: `0 0 10px rgba(${accent},1)` }} />;
  const fmtDur = (ms) => { if (!ms) return ''; const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const dlIcon = (st) => st === 'done'
    ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
    : st === 'queued'
      ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3a9 9 0 1 0 9 9" className="xp-spin" /></svg>
      : st === 'failed'
        ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>;

  // ===== EXPLORE FEED ======================================================
  return (
    <div ref={scrollRef} className="xp-scroll" style={{
      position: 'relative', zIndex: 1, flex: 1, overflowY: 'auto', overflowX: 'hidden',
      padding: '34px clamp(28px, 5vw, 60px) 80px',
    }}>
      <style>{EXPLORE_CSS}</style>

      <div className="xp-inner" style={{ position: 'relative', zIndex: 1, maxWidth: 1080, margin: '0 auto' }}>
        {/* Header */}
        <div className="xp-head">
          <div className="xp-head-left">
            <div className="xp-greeting">{dot}{greeting}</div>
            <div className="xp-wordmark">Immerse</div>
            <div className="xp-tag">Explore what’s out there.</div>
          </div>
          {library.length > 0 ? (
            <button type="button" className="xp-start" style={{ '--acc': accent }} onClick={handleStartListening}>
              <span className="xp-start-ico"><svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg></span>
              <span className="xp-start-tx">
                <span className="xp-start-t">Start listening</span>
                <span className="xp-start-s">Shuffle your library</span>
              </span>
            </button>
          ) : null}
        </div>

        {/* ===== Combined "For you" — favorites + rediscovery in one feed ===== */}
        {forYouMix.length > 0 ? (
          <section className="xp-sec" style={{ marginBottom: 36 }}>
            <div className="xp-label">{dot}For you · from your library</div>
            <div className="xp-foryou">
              {forYouMix.map(({ t, reason }) => (
                <div key={t.id} className="xp-fy" role="button" tabIndex={0}
                  onClick={() => handleRecentPlay(t)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRecentPlay(t); } }}
                  title={`${t.album || t.title} · ${t.artist}`}>
                  <span className="xp-fy-cov" style={{ backgroundImage: t.coverArt ? `url(${t.coverArt})` : 'none' }}>
                    <button type="button" className="xp-fy-play" aria-label="Play"
                      onClick={(e) => { e.stopPropagation(); handleRecentPlay(t); }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="#000"><path d="M8 5v14l11-7z" /></svg>
                    </button>
                    <span className="xp-fy-go" aria-label="Open in library"
                      role="button" tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); onOpenAlbumInLibrary?.(t.album || t.title); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpenAlbumInLibrary?.(t.album || t.title); } }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                    </span>
                  </span>
                  <span className={`xp-fy-reason ${reason}`} style={{ '--acc': accent }}>{reason === 'favorite' ? 'Favorite' : 'Rediscover'}</span>
                  <span className="xp-fy-t">{t.album || t.title}</span>
                  <span className="xp-fy-a">{t.artist || 'Unknown Artist'}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* 3 — New Releases from artists you follow — full list, inline expand */}
        <section className="xp-sec" style={{ marginBottom: 34 }}>
          <div className="xp-label">{dot}New from artists you follow</div>
          {followedNewReleases.length === 0 ? (
            <div className="xp-msg" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
              <span>Follow some artists to see their latest releases here.</span>
              <button type="button" className="xp-pill-ghost" onClick={onOpenNew}>Manage followed artists</button>
            </div>
          ) : (
            <div className="xp-rel-list">
              {followedNewReleases.map((a) => {
                const isSingle = a.itemType === 'single';
                const open = expandedAlbumId === Number(a.id);
                const sdKey = `song:${a.id}`;
                const sdState = dlState[sdKey];
                const tracks = albumTracksCache[Number(a.id)];
                const loading = albumLoading[Number(a.id)];
                const err = albumError[Number(a.id)];
                return (
                  <div key={a.id} className={`xp-rel${open ? ' open' : ''}`} style={{ '--acc': accent }}>
                    <button type="button" className="xp-rel-row"
                      onClick={() => { if (isSingle) { if (!sdState || sdState === 'failed') downloadChartSong(a); } else toggleAlbum(a); }}
                      aria-expanded={isSingle ? undefined : open}>
                      <span className="xp-rel-cov" style={{ backgroundImage: a.artworkUrl ? `url(${a.artworkUrl})` : 'none' }} />
                      <span className="xp-rel-meta">
                        <span className="xp-rel-t">{a.name}<span className={`xp-rel-tag${isSingle ? ' single' : ''}`}>{isSingle ? 'Single' : 'Album'}</span></span>
                        <span className="xp-rel-a">{a.artistName}{a.releaseDate ? ` · ${new Date(a.releaseDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}{!isSingle && a.itemType === 'album' ? '' : ''}</span>
                      </span>
                      <span className={`xp-rel-act${(isSingle && sdState) ? ` ${sdState}` : ''}`}>
                        {isSingle ? dlIcon(sdState) : (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .25s' }}><path d="M6 9l6 6 6-6" /></svg>
                        )}
                      </span>
                    </button>

                    {!isSingle && open ? (
                      <div className="xp-rel-panel">
                        <div className="xp-rel-panel-bar">
                          <button type="button" className="xp-ap-all" onClick={(e) => { e.stopPropagation(); downloadWholeAlbum(a); }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                            Download all
                          </button>
                          {a.genre ? <span className="xp-rel-genre">{a.genre}</span> : null}
                        </div>
                        <div className="xp-ap-tracks">
                          {loading ? <div className="xp-msg">Loading tracks…</div>
                            : err ? <div className="xp-msg">Couldn’t load tracks.</div>
                              : tracks && tracks.length ? tracks.map((tk, ti) => {
                                const key = `atrk:${a.id}:${tk.trackId}`;
                                const st = dlState[key];
                                return (
                                  <div key={tk.trackId || ti} className="xp-ap-row">
                                    <span className="xp-ap-n">{tk.trackNumber || ti + 1}</span>
                                    <span className="xp-ap-tn">{tk.trackName}</span>
                                    {tk.explicit ? <span className="xp-ap-e">E</span> : null}
                                    <span className="xp-ap-dur">{fmtDur(tk.trackTimeMillis)}</span>
                                    <button type="button" className={`xp-dl${st ? ` ${st}` : ''}`} aria-label="Download" title={st || 'Download'}
                                      onClick={(e) => { e.stopPropagation(); if (!st || st === 'failed') downloadAlbumTrack(a, tk); }}>{dlIcon(st)}</button>
                                  </div>
                                );
                              }) : <div className="xp-msg">No track information.</div>}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 2 — Top Songs (Apple charts) — 2-column grid, 2×5 default, expand to 50 */}
        <section className="xp-sec" style={{ marginBottom: 34 }}>
          <div className="xp-label">{dot}Top songs right now · Apple Music</div>
          {chartsLoading ? (
            <div className="xp-song-grid">
              {Array.from({ length: 10 }).map((_, i) => <div key={i} className="xp-skel-row" />)}
            </div>
          ) : charts.songs.length === 0 ? (
            <div className="xp-msg">{chartsError ? 'Couldn’t load charts right now.' : 'No chart data available.'}</div>
          ) : (
            <>
              <div className="xp-song-grid">
                {charts.songs.slice(0, songsExpanded ? 50 : 10).map((s, i) => {
                  const key = `song:${s.id}`;
                  const st = dlState[key];
                  return (
                    <div key={s.id} className="xp-song" style={{ '--acc': accent, animationDelay: `${(i % 10) * 40}ms` }}>
                      <span className="xp-rank">{i + 1}</span>
                      <span className="xp-song-cov" style={{ backgroundImage: s.artworkUrl ? `url(${s.artworkUrl})` : 'none' }} />
                      <span className="xp-song-meta">
                        <span className="xp-song-t">{s.name}</span>
                        <span className="xp-song-a">{s.artistName}{s.genre ? ` · ${s.genre}` : ''}</span>
                      </span>
                      <button type="button" className={`xp-dl${st ? ` ${st}` : ''}`} aria-label="Download"
                        title={st || 'Download'} onClick={() => { if (!st || st === 'failed') downloadChartSong(s); }}>
                        {dlIcon(st)}
                      </button>
                    </div>
                  );
                })}
              </div>
              {charts.songs.length > 10 ? (
                <button type="button" className="xp-viewmore" style={{ '--acc': accent }}
                  onClick={() => setSongsExpanded((v) => !v)}>
                  {songsExpanded ? 'Show top 10' : `View top ${Math.min(50, charts.songs.length)}`}
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transform: songsExpanded ? 'rotate(180deg)' : 'none', transition: 'transform .25s' }}><path d="M6 9l6 6 6-6" /></svg>
                </button>
              ) : null}
            </>
          )}
        </section>

        {/* Stats footer */}
        <div className="xp-stats">
          <span><b>{library.length}</b> {library.length === 1 ? 'track' : 'tracks'}</span>
          {albumCount > 0 ? <><span className="sep">·</span><span><b>{albumCount}</b> {albumCount === 1 ? 'album' : 'albums'}</span></> : null}
          {playlists.length > 0 ? <><span className="sep">·</span><span><b>{playlists.length}</b> {playlists.length === 1 ? 'playlist' : 'playlists'}</span></> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * ActionCard — small glass tile used in the welcome screen action row.
 * Icon-on-top, label-below layout. Slightly smaller than the recently-played
 * cover tiles so they read as "secondary" but visually match the same
 * design language (same glass, same accent ring shadow, same hover lift).
 */
function ActionCard({ onClick, label, icon, accent = '48, 48, 48', disabled = false }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onBlur={() => setPressed(false)}
      className="imm-action-card"
      style={{
        width: 92, padding: '14px 8px 12px',
        borderRadius: 12,
        background: 'rgba(18, 18, 20, 0.7)',
        backdropFilter: 'blur(28px) saturate(1.6)',
        WebkitBackdropFilter: 'blur(28px) saturate(1.6)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: `
          0 8px 24px rgba(0,0,0,0.4),
          0 0 0 1px rgba(${accent}, 0.08),
          inset 0 1px 0 rgba(255,255,255,0.04)
        `,
        color: 'rgba(255,255,255,0.85)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
        // press-bounce — scale down on mouse-down then bounce back via the
        // CSS transition release. Disabled state skips the transform.
        transform: pressed && !disabled ? 'scale(0.94)' : 'scale(1)',
        transition: 'transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s, border-color 0.2s, box-shadow 0.25s',
      }}
    >
      <div style={{
        color: `rgba(${accent}, 1)`, opacity: 0.95,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </div>
      <div style={{
        fontSize: 10.5, fontWeight: 600, color: 'rgba(255,255,255,0.85)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        width: '100%', textAlign: 'center',
      }}>
        {label}
      </div>
    </button>
  );
}


export { WelcomeScreen, ActionCard };
