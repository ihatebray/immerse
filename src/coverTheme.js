/** Average-color theme from cover art for gradients (renderer-safe). */
export function sampleCoverTheme(src) {
  const fallback = { accent: '48, 48, 48', wash: '10, 10, 10', mid: '12, 12, 12', deep: '0, 0, 0' };
  return new Promise((resolve) => {
    if (!src) {
      resolve(fallback);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const w = 56;
        const h = 56;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(fallback);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 30) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n += 1;
        }
        if (!n) {
          resolve(fallback);
          return;
        }
        r = Math.round(r / n);
        g = Math.round(g / n);
        b = Math.round(b / n);
        const washR = Math.round(r * 0.18 + 6 * 0.82);
        const washG = Math.round(g * 0.18 + 6 * 0.82);
        const washB = Math.round(b * 0.18 + 6 * 0.82);
        const midR = Math.round(r * 0.34 + 4 * 0.66);
        const midG = Math.round(g * 0.34 + 4 * 0.66);
        const midB = Math.round(b * 0.34 + 4 * 0.66);
        resolve({
          accent: `${r}, ${g}, ${b}`,
          wash: `${washR}, ${washG}, ${washB}`,
          mid: `${midR}, ${midG}, ${midB}`,
          deep: '0, 0, 0',
        });
      } catch {
        resolve(fallback);
      }
    };
    img.onerror = () => resolve(fallback);
    img.src = src;
  });
}
