import React, { useEffect, useRef } from 'react';

function EdgeBleedBand({ accent }) {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: 0, right: 0, bottom: 0,
        height: 60,
        zIndex: 2,
        pointerEvents: 'none',
        // Tall ellipse anchored to the bottom centre. The radial gradient
        // gives a soft light-leak feel — strongest in the lower middle,
        // fading out at the top edge and to either side.
        background: `radial-gradient(ellipse 80% 100% at 50% 100%, rgba(${accent}, 0.32) 0%, rgba(${accent}, 0.10) 40%, rgba(${accent}, 0) 80%)`,
        // Multiply blend lets the underlying gradient field's colour
        // peek through, so the bleed reads as additive light rather
        // than an opaque overlay.
        mixBlendMode: 'screen',
        transition: 'background 600ms ease',
      }}
    />
  );
}


function AnimatedGradientBg({ accent, mid, wash, coverUrl, analyserRef, beatReactive, isPlaying }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const imgRef = useRef(null);
  const coverUrlRef = useRef(null);
  // Smoothed beat envelope — climbs fast on hits, decays slowly. Stored in a
  // ref so we don't re-run the effect every frame.
  const beatEnvRef = useRef(0);
  // Frequency-data buffer; sized when the analyser first appears.
  const freqBufRef = useRef(null);
  // Latest props mirrored into refs so the long-lived RAF closure always
  // reads current values without restarting.
  const propsRef = useRef({ analyserRef, beatReactive, isPlaying });
  useEffect(() => {
    propsRef.current = { analyserRef, beatReactive, isPlaying };
  }, [analyserRef, beatReactive, isPlaying]);

  // Load the cover image whenever coverUrl changes
  useEffect(() => {
    if (!coverUrl) {
      imgRef.current = null;
      coverUrlRef.current = null;
      return;
    }
    if (coverUrl === coverUrlRef.current) return;
    coverUrlRef.current = coverUrl;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
    };
    img.onerror = () => {
      imgRef.current = null;
    };
    img.src = coverUrl;
  }, [coverUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Run at extreme low resolution — CSS upscaling to full size creates
    // heavy natural blur. 32px → ~900px display = 28× scale, which completely
    // destroys any recognizable image structure.
    const W = 32;
    const H = 32;
    canvas.width = W;
    canvas.height = H;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // 4 layers: [relativeSize, orbitRadius, orbitSpeed, spinSpeed, initialAngle]
    // Orbit radius is in normalized units (0-1 of the canvas size)
    // Two big layers spin in place (orbit=0), two small ones orbit + spin
    const layers = prefersReduced ? [
      [1.2,  0,    0,     0,     0   ],
      [0.8,  0,    0,     0,     0   ],
      [0.6,  0,    0,     0,     0   ],
      [0.4,  0,    0,     0,     0   ],
    ] : [
      [1.25, 0,    0.0,   0.022, 0   ],  // huge, very slow spin in place
      [0.90, 0,    0.0,  -0.031, 1.1 ],  // large, slow opposite spin
      [0.70, 0.18, 0.038, 0.055, 0.5 ],  // medium, gentle orbit + spin
      [0.55, 0.24, -0.051, 0.07, 2.4 ],  // slightly smaller, slow orbit
    ];

    const cx = W / 2;
    const cy = H / 2;
    const startTime = performance.now();

    const frame = () => {
      const t = (performance.now() - startTime) / 1000; // seconds

      /* ---- Beat envelope sampling ----
       * Read the lowest ~10% of the frequency spectrum (roughly the bass
       * range) and mix it into a smoothed envelope. Climb fast on hits
       * (attack), decay slow (release). Reduced motion users opt out of
       * the kinetic boost regardless of preference. */
      let beat = 0;
      const { analyserRef: aRef, beatReactive: br, isPlaying: ip } = propsRef.current;
      const analyser = aRef?.current;
      if (br && ip && analyser && !prefersReduced) {
        if (!freqBufRef.current || freqBufRef.current.length !== analyser.frequencyBinCount) {
          freqBufRef.current = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(freqBufRef.current);
        const bins = freqBufRef.current;
        // Average the bottom ~50 bins (roughly 0–1.5 kHz at 44.1 kHz / 1024 fft).
        const N = Math.min(50, bins.length);
        let sum = 0;
        for (let i = 0; i < N; i++) sum += bins[i];
        const avg = (sum / N) / 255; // 0..1
        // Attack/release shaping
        const env = beatEnvRef.current;
        const target = avg;
        const next = target > env
          ? env + (target - env) * 0.45   // fast attack
          : env + (target - env) * 0.06;  // slow release
        beatEnvRef.current = next;
        beat = next;
      } else {
        // Decay to zero when reactivity is off, paused, or no analyser.
        beatEnvRef.current = beatEnvRef.current * 0.92;
        beat = beatEnvRef.current;
      }

      ctx.clearRect(0, 0, W, H);

      // Background fill using the extracted theme colours as a fallback
      // (shows when no image is loaded yet, or when image fails)
      const fallback = ctx.createRadialGradient(cx, cy * 0.6, 0, cx, cy, W * 0.8);
      fallback.addColorStop(0, `rgba(${accent}, 0.9)`);
      fallback.addColorStop(0.5, `rgba(${mid}, 0.7)`);
      fallback.addColorStop(1, `rgba(${wash}, 0.5)`);
      ctx.fillStyle = fallback;
      ctx.fillRect(0, 0, W, H);

      const img = imgRef.current;
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';

        for (const [relSize, orbitR, orbitSpeed, spinSpeed, initAngle] of layers) {
          const orbitAngle = initAngle + t * orbitSpeed;
          // Beat-modulated orbit & size — bass hits push layers outward and
          // grow them ~20% momentarily. Subtle for low beat values, alive
          // for big bass kicks. Uses the smoothed envelope so the motion
          // never strobes between frames.
          const beatBoost = 1 + beat * 0.22;
          const orbitBoost = 1 + beat * 0.4;
          const ox = cx + orbitR * orbitBoost * W * Math.cos(orbitAngle);
          const oy = cy + orbitR * orbitBoost * H * Math.sin(orbitAngle);
          const spinAngle = initAngle * 0.5 + t * spinSpeed;
          const size = relSize * beatBoost * W;

          ctx.save();
          ctx.translate(ox, oy);
          ctx.rotate(spinAngle);
          // Beat also pushes alpha up slightly so the colours feel "lit".
          ctx.globalAlpha = Math.min(1, 0.55 + beat * 0.25);
          ctx.drawImage(img, -size / 2, -size / 2, size, size);
          ctx.restore();
        }

        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);  // accent/mid/wash read via fallback gradient which rerenders on prop change

  // When accent/mid/wash change (track change), the next frame automatically
  // picks them up via closure. No restart needed.

  return (
    <>
      {/* The canvas renders at 80×80 and is scaled up to full size.
          The bicubic upscaling + the CSS blur together create a very smooth
          smeared-colours effect identical to a heavy Gaussian blur. */}
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none',
          // imageRendering: pixelated would break the blur — leave as default
          filter: 'blur(40px) saturate(1.8)',
          transition: 'opacity 0.8s ease',
        }}
      />
      {/* Vignette — bottom darkens more so track info stays readable */}
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.65) 50%, rgba(0,0,0,0.94) 100%)',
        }}
      />
    </>
  );
}


export { EdgeBleedBand, AnimatedGradientBg };
