/* Qlass achiever artwork — draws "Honours" certificates, recaps and 15s reels onto a <canvas>.
   Shared by the Social Studio, the TV player and the server-side portal pages. */
(function () {
  const NAVY = '#0D0B6E', NAVY2 = '#1C1A9C', NAVY3 = '#08064F', GOLD = '#F5B83D', SOFT = '#C9CCF5', MUTED = '#8E93D6', BLUE = '#1717C1', CREAM = '#E8D3A2';
  const SERIF = "'DM Serif Display', Georgia, serif", SANS = "'Manrope', system-ui, sans-serif";
  const FORMATS = {
    landscape: { w: 1920, h: 1080, label: 'TV / Landscape 16:9' },
    portrait: { w: 1080, h: 1350, label: 'Insta post 4:5' },
    square: { w: 1080, h: 1080, label: 'Square 1:1' },
    story: { w: 1080, h: 1920, label: 'Story / Reel 9:16' },
  };
  const REEL_SECONDS = 15;
  const clamp = (x) => Math.min(1, Math.max(0, x));
  const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const backOut = (x) => { x = clamp(x); const c = 1.5; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  const A = (o, start, d = 0.7) => (o.t == null ? 1 : ease((o.t * (o.speed || 1) - start) / d));
  const P = (o, start, d = 0.8) => (o.t == null ? 1 : backOut((o.t * (o.speed || 1) - start) / d));

  function font(ctx, w, size, fam, italic) { ctx.font = `${italic ? 'italic ' : ''}${w} ${size}px ${fam}`; }
  function fit(ctx, str, w, size, fam, maxW, italic) {
    font(ctx, w, size, fam, italic);
    const m = ctx.measureText(str).width;
    if (m > maxW) { size = Math.max(size * 0.35, size * maxW / m); font(ctx, w, size, fam, italic); }
    return size;
  }
  function txt(ctx, str, x, y, o) {
    if (!str) return { width: 0, size: o.size };
    ctx.save();
    ctx.fillStyle = o.color || '#fff'; ctx.textAlign = o.align || 'center'; ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = (o.ls || 0) + 'px';
    const size = o.maxW ? fit(ctx, str, o.w || 400, o.size, o.fam || SANS, o.maxW, o.italic) : (font(ctx, o.w || 400, o.size, o.fam || SANS, o.italic), o.size);
    ctx.fillText(str, x, y);
    const width = ctx.measureText(str).width;
    ctx.restore();
    return { width, size };
  }
  function measure(ctx, str, w, size, fam, ls, italic) {
    ctx.save(); font(ctx, w, size, fam, italic); if ('letterSpacing' in ctx) ctx.letterSpacing = (ls || 0) + 'px';
    const m = ctx.measureText(str).width; ctx.restore(); return m;
  }
  function withA(ctx, a, dy, fn) {
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha *= a; ctx.translate(0, (1 - a) * dy); fn(); ctx.restore();
  }
  function withPop(ctx, p, cx, cy, fn) {
    if (p <= 0) return;
    ctx.save(); ctx.globalAlpha *= clamp(p * 1.6); const s = 0.6 + 0.4 * p;
    ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy); fn(); ctx.restore();
  }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  }

  let BGP = null;
  function bg(ctx, W, H, fx, fy) {
    ctx.fillStyle = NAVY3; ctx.fillRect(0, 0, W, H);
    if (BGP && BGP.width) {
      const sc = Math.max(W / BGP.width, H / BGP.height), w = BGP.width * sc, h = BGP.height * sc;
      ctx.drawImage(BGP, (W - w) / 2, (H - h) / 2, w, h);
      ctx.fillStyle = 'rgba(8,6,79,.30)'; ctx.fillRect(0, 0, W, H);
      const g2 = ctx.createRadialGradient(W * fx, H * fy, 0, W * fx, H * fy, Math.max(W, H) * 0.8);
      g2.addColorStop(0, 'rgba(28,26,156,.62)'); g2.addColorStop(0.5, 'rgba(13,11,110,.74)'); g2.addColorStop(1, 'rgba(8,6,79,.9)');
      ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
      return;
    }
    const g = ctx.createRadialGradient(W * fx, H * fy, 0, W * fx, H * fy, Math.max(W, H) * 0.75);
    g.addColorStop(0, NAVY2); g.addColorStop(0.6, NAVY); g.addColorStop(1, NAVY3);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function frame(ctx, W, H, u, a) {
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha *= a;
    ctx.strokeStyle = 'rgba(245,184,61,.75)'; ctx.lineWidth = 2 * u; ctx.strokeRect(36 * u, 36 * u, W - 72 * u, H - 72 * u);
    ctx.strokeStyle = 'rgba(245,184,61,.35)'; ctx.lineWidth = 1 * u; ctx.strokeRect(50 * u, 50 * u, W - 100 * u, H - 100 * u);
    ctx.restore();
  }
  function logo(ctx, img, x, y, h, align) {
    if (!img || !img.width) return 0;
    const w = h * img.width / img.height;
    const lx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    ctx.drawImage(img, lx, y - h / 2, w, h);
    return w;
  }
  function photo(ctx, cx, cy, d, img, initials) {
    const r = d / 2, ring = Math.max(3, d * 0.013), pad = d * 0.03, ir = r - ring - pad;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r - ring / 2, 0, Math.PI * 2); ctx.strokeStyle = GOLD; ctx.lineWidth = ring; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, ir, 0, Math.PI * 2); ctx.fillStyle = BLUE; ctx.fill();
    if (img && img.width) {
      ctx.clip();
      const s = Math.max((ir * 2) / img.width, (ir * 2) / img.height), w = img.width * s, h = img.height * s;
      ctx.drawImage(img, cx - w / 2, cy - h / 2 + (h - ir * 2) * -0.2, w, h);
    } else {
      txt(ctx, initials || '', cx, cy + ir * 0.04, { size: ir * 0.8, fam: SERIF, color: '#fff' });
    }
    ctx.restore();
  }
  function pill(ctx, str, x, cy, size, u, align, maxW) {
    if (!str) return;
    maxW = maxW || ctx.canvas.width - 200 * u;
    let tw = measure(ctx, str, 700, size, SANS);
    if (tw + size * 2.4 > maxW) { const k = Math.max(0.6, (maxW - size * 2.4) / tw); size *= k; tw = measure(ctx, str, 700, size, SANS); }
    while (tw + size * 2.4 > maxW && str.length > 4) { str = str.replace(/\s*\S+…?$/, '') + '…'; tw = measure(ctx, str, 700, size, SANS); }
    const w = tw + size * 2.4, h = size * 2.05;
    const lx = align === 'right' ? x - w : align === 'left' ? x : x - w / 2;
    ctx.save(); rr(ctx, lx, cy - h / 2, w, h, h / 2); ctx.strokeStyle = 'rgba(245,184,61,.7)'; ctx.lineWidth = 1.5 * u; ctx.stroke(); ctx.restore();
    txt(ctx, str, lx + w / 2, cy, { size, w: 700, color: '#fff' });
  }
  function nameLayout(ctx, name, size, maxW, allowTwo) {
    font(ctx, 400, size, SERIF);
    const full = ctx.measureText(name).width;
    const words = name.split(' ');
    if (full <= maxW || !allowTwo || words.length < 2) return { lines: [name], size: full > maxW ? size * maxW / full : size };
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      const m = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
      if (!best || m < best.m) best = { a, b, m };
    }
    if (size * maxW / full >= size * 0.78) return { lines: [name], size: size * maxW / full };
    return { lines: [best.a, best.b], size: Math.min(size, size * maxW / best.m) };
  }
  function counted(s, k) {
    const dec = (String(s.marks).split('.')[1] || '').length;
    const m = Number(s.marks);
    return { marks: s.marks === '' || isNaN(m) ? String(s.marks || '') : (m * k).toFixed(dec), pct: Math.round((Number(s.pct) || 0) * k) + '%' };
  }
  function scoreRow(ctx, s, x, cy, o) {
    const { size, lab, u, align, k } = o, gap = 56 * u * (size / 118);
    const c = counted(s, k), out = s.total ? '/' + s.total : '';
    const final = counted(s, 1);
    const wm = measure(ctx, final.marks, 400, size, SERIF) + measure(ctx, out, 400, size * 0.54, SERIF);
    const w1 = Math.max(wm, measure(ctx, 'MARKS', 800, lab, SANS, lab * 0.3));
    const w2 = Math.max(measure(ctx, final.pct, 400, size, SERIF), measure(ctx, 'SCORE', 800, lab, SANS, lab * 0.3));
    const total = w1 + gap * 2 + 2 * u + w2;
    let x0 = align === 'left' ? x : x - total / 2;
    const ny = cy - lab * 0.55, ly = cy + size * 0.5;
    const hasMarks = !!final.marks;
    if (hasMarks) {
      const mw = measure(ctx, c.marks, 400, size, SERIF), ow = measure(ctx, out, 400, size * 0.54, SERIF);
      const mx = align === 'left' ? x0 : x0 + (w1 - (mw + ow)) / 2;
      txt(ctx, c.marks, mx, ny, { size, fam: SERIF, color: GOLD, align: 'left' });
      txt(ctx, out, mx + mw, ny + size * 0.14, { size: size * 0.54, fam: SERIF, color: CREAM, align: 'left' });
      txt(ctx, 'MARKS', align === 'left' ? x0 : x0 + w1 / 2, ly, { size: lab, w: 800, color: SOFT, ls: lab * 0.3, align: align === 'left' ? 'left' : 'center' });
      ctx.save(); ctx.fillStyle = 'rgba(245,184,61,.5)'; ctx.fillRect(x0 + w1 + gap, cy - size * 0.55, 2 * u, size * 1.1); ctx.restore();
      x0 += w1 + gap * 2 + 2 * u;
    } else if (align !== 'left') x0 = x - w2 / 2;
    txt(ctx, c.pct, align === 'left' ? x0 : x0 + w2 / 2, ny, { size, fam: SERIF, color: GOLD, align: align === 'left' ? 'left' : 'center' });
    txt(ctx, 'SCORE', align === 'left' ? x0 : x0 + w2 / 2, ly, { size: lab, w: 800, color: SOFT, ls: lab * 0.3, align: align === 'left' ? 'left' : 'center' });
    return x0 + w2;
  }
  const subjExam = (s) => [s.best && s.best.includes('·') ? s.best : s.subject, s.exam].filter(Boolean).join(' · ');
  const clsSchool = (s) => [s.cls, s.school].filter(Boolean).join(' · ');
  const countK = (o) => (o.t == null ? 1 : ease((o.t * (o.speed || 1) - 3.0) / 1.6));

  function ctaStrip(ctx, W, H, u, o) {
    const sh = 104 * u, y = H - 50 * u - sh, x0 = 50 * u, x1 = W - 50 * u;
    ctx.save(); ctx.fillStyle = GOLD; ctx.fillRect(x0, y, x1 - x0, sh); ctx.restore();
    const parts = String(o.contact || '').split('·').map((x) => x.trim()).filter(Boolean);
    txt(ctx, (o.cta || 'Admissions open · Book a free demo class').toUpperCase(), x0 + 40 * u, y + sh / 2, { size: 25 * u, w: 800, color: NAVY, ls: 1.5 * u, align: 'left', maxW: (x1 - x0) * 0.58 });
    txt(ctx, parts[parts.length - 1] || '', x1 - 40 * u, y + sh / 2 - 15 * u, { size: 26 * u, w: 800, color: NAVY, align: 'right', maxW: (x1 - x0) * 0.34 });
    txt(ctx, (parts.length > 1 ? parts[0] : '').toUpperCase(), x1 - 40 * u, y + sh / 2 + 18 * u, { size: 17 * u, w: 700, color: NAVY, ls: 2 * u, align: 'right', maxW: (x1 - x0) * 0.34 });
  }
  const STRIP = 104;
  function drawTall(ctx, W, H, s, o) {
    const u = W / 1080, story = H / W > 1.6;
    const c = story
      ? { pt: 150, pb: 130, logo: 76, kick: 26, cong: 124, photo: 420, name: 96, school: 32, num: 150, lab: 22, pill: 30, contact: 24 }
      : { pt: 70, pb: 56, logo: 62, kick: 22, cong: 108, photo: 316, name: 78, school: 28, num: 118, lab: 18, pill: 26, contact: 20 };
    c.pb += STRIP; c.contact = 0;
    for (const k in c) c[k] *= u;
    bg(ctx, W, H, 0.5, 0.38);
    frame(ctx, W, H, u, A(o, 0.1, 0.9));
    const maxW = W - 280 * u, cx = W / 2;
    const nl = nameLayout(ctx, s.name || '', c.name, maxW, true);
    const nameH = nl.lines.length * nl.size * 1.08;
    const blocks = [c.logo, c.kick * 1.2 + 14 * u + c.cong, c.photo, nameH + 16 * u + c.school * 1.3, c.num + 10 * u + c.lab * 1.3, c.pill * 2 + 26 * u + c.contact * 1.3];
    const top = 50 * u + c.pt, avail = H - 100 * u - c.pt - c.pb;
    const gap = Math.max(10 * u, (avail - blocks.reduce((a, b) => a + b, 0)) / (blocks.length - 1));
    let y = top;
    const ys = blocks.map((h) => { const r = y; y += h + gap; return r; });
    withA(ctx, A(o, 0.4), 30 * u, () => logo(ctx, o.logo, cx, ys[0] + c.logo / 2, c.logo, 'center'));
    withA(ctx, A(o, 0.8), 30 * u, () => txt(ctx, (o.kicker || '★  TOPPER ALERT  ★'), cx, ys[1] + c.kick * 0.6, { size: c.kick, w: 800, color: GOLD, ls: c.kick * 0.34, maxW }));
    withA(ctx, A(o, 1.0), 40 * u, () => txt(ctx, (o.headline || 'Star Performer'), cx, ys[1] + c.kick * 1.2 + 14 * u + c.cong * 0.5, { size: c.cong, fam: SERIF, italic: true, maxW }));
    withPop(ctx, P(o, 1.5), cx, ys[2] + c.photo / 2, () => photo(ctx, cx, ys[2] + c.photo / 2, c.photo, s.photo, s.initials));
    withA(ctx, A(o, 2.2), 40 * u, () => nl.lines.forEach((ln, i) => txt(ctx, ln, cx, ys[3] + nl.size * 0.54 + i * nl.size * 1.08, { size: nl.size, fam: SERIF })));
    withA(ctx, A(o, 2.5), 30 * u, () => txt(ctx, clsSchool(s), cx, ys[3] + nameH + 16 * u + c.school * 0.6, { size: c.school, w: 600, color: SOFT, maxW }));
    withA(ctx, A(o, 3.0), 40 * u, () => scoreRow(ctx, s, cx, ys[4] + c.num * 0.5, { size: c.num, lab: c.lab, u, align: 'center', k: countK(o) }));
    withA(ctx, A(o, 4.0), 30 * u, () => pill(ctx, subjExam(s), cx, ys[5] + c.pill, c.pill, u, 'center'));
    withA(ctx, A(o, 4.3), 20 * u, () => ctaStrip(ctx, W, H, u, o));
  }

  function drawLandscape(ctx, W, H, s, o) {
    const u = W / 1920;
    bg(ctx, W, H, 0.3, 0.5);
    frame(ctx, W, H, u, A(o, 0.1, 0.9));
    const x0 = 770 * u, x1 = 1760 * u, maxW = x1 - x0;
    withPop(ctx, P(o, 1.2), 410 * u, H / 2, () => photo(ctx, 410 * u, H / 2, 500 * u, s.photo, s.initials));
    withA(ctx, A(o, 0.4), 20 * u, () => {
      logo(ctx, o.logo, x0, 151 * u, 62 * u, 'left');
      txt(ctx, (o.contact || '').toUpperCase(), x1, 151 * u, { size: 22 * u, w: 700, color: MUTED, ls: 4.4 * u, align: 'right' });
    });
    withA(ctx, A(o, 0.8), 30 * u, () => txt(ctx, (o.kicker || '★  TOPPER ALERT  ★'), x0, 372 * u, { size: 24 * u, w: 800, color: GOLD, ls: 8 * u, align: 'left' }));
    withA(ctx, A(o, 1.0), 40 * u, () => txt(ctx, (o.headline || 'Star Performer'), x0, 462 * u, { size: 120 * u, fam: SERIF, italic: true, align: 'left', maxW }));
    withA(ctx, A(o, 2.0), 40 * u, () => txt(ctx, s.name, x0, 590 * u, { size: 84 * u, fam: SERIF, align: 'left', maxW }));
    withA(ctx, A(o, 2.3), 30 * u, () => txt(ctx, clsSchool(s), x0, 655 * u, { size: 30 * u, w: 600, color: SOFT, align: 'left', maxW }));
    withA(ctx, A(o, 2.6), 30 * u, () => pill(ctx, subjExam(s), x0, 735 * u, 26 * u, u, 'left', x1 - x0));
    withA(ctx, A(o, 3.0), 40 * u, () => scoreRow(ctx, s, x0, 880 * u, { size: 118 * u, lab: 18 * u, u, align: 'left', k: countK(o) }));
  }

  function drawSquare(ctx, W, H, s, o) {
    const u = W / 1080, cx = W / 2;
    bg(ctx, W, H, 0.5, 0.45);
    frame(ctx, W, H, u, A(o, 0.1, 0.9));
    withA(ctx, A(o, 0.4), 20 * u, () => logo(ctx, o.logo, cx, 145 * u, 54 * u, 'center'));
    withA(ctx, A(o, 0.8), 30 * u, () => txt(ctx, (o.kicker || '★  TOPPER ALERT  ★'), cx, 228 * u, { size: 20 * u, w: 800, color: GOLD, ls: 6.8 * u }));
    withA(ctx, A(o, 1.0), 40 * u, () => txt(ctx, (o.headline || 'Star Performer'), cx, 305 * u, { size: 92 * u, fam: SERIF, italic: true, maxW: 800 * u }));
    withPop(ctx, P(o, 1.5), 285 * u, 525 * u, () => photo(ctx, 285 * u, 525 * u, 300 * u, s.photo, s.initials));
    const x0 = 486 * u, maxW = 464 * u;
    const nl = nameLayout(ctx, s.name || '', 62 * u, maxW, true);
    const nTop = 455 * u - (nl.lines.length * nl.size * 1.08) / 2;
    withA(ctx, A(o, 2.2), 30 * u, () => nl.lines.forEach((ln, i) => txt(ctx, ln, x0, nTop + nl.size * 0.54 + i * nl.size * 1.08, { size: nl.size, fam: SERIF, align: 'left' })));
    withA(ctx, A(o, 2.5), 20 * u, () => txt(ctx, clsSchool(s), x0, 545 * u, { size: 24 * u, w: 600, color: SOFT, align: 'left', maxW }));
    withA(ctx, A(o, 3.0), 30 * u, () => scoreRow(ctx, s, x0, 628 * u, { size: 84 * u, lab: 15 * u, u, align: 'left', k: countK(o) }));
    withA(ctx, A(o, 4.0), 30 * u, () => pill(ctx, subjExam(s), cx, 790 * u, 26 * u, u, 'center'));
    withA(ctx, A(o, 4.3), 20 * u, () => ctaStrip(ctx, W, H, u, o));
  }

  // Qlass Coins leaderboards. Every board (coins, DPP, attendance) is the same ranked shape, so one
  // renderer covers them all and each just carries its own title, unit and accent colour.
  function drawBoardLandscape(ctx, W, H, b, o) {
    const u = W / 1920;
    const accent = b.accent || GOLD;
    const x0 = 160 * u, x1 = 1760 * u, span = x1 - x0;
    bg(ctx, W, H, 0.5, 0.5);
    frame(ctx, W, H, u, A(o, 0.1, 0.9));
    withA(ctx, A(o, 0.4), 20 * u, () => {
      logo(ctx, o.logo, x0, 151 * u, 62 * u, 'left');
      txt(ctx, (o.contact || '').toUpperCase(), x1, 151 * u, { size: 22 * u, w: 700, color: MUTED, ls: 4.4 * u, align: 'right' });
    });
    withA(ctx, A(o, 0.7), 30 * u, () => txt(ctx, String(b.subtitle || '').toUpperCase(), x0, 248 * u, { size: 23 * u, w: 800, color: accent, ls: 5.5 * u, align: 'left', maxW: span }));
    withA(ctx, A(o, 0.9), 40 * u, () => txt(ctx, b.title || 'Leaderboard', x0, 326 * u, { size: 74 * u, fam: SERIF, italic: true, align: 'left', maxW: span }));
    // Boards built from marksheets the students upload themselves say so, quietly. It sits under
    // the title in muted small caps so a parent reading the room can tell at a glance which
    // numbers came from our own records and which came from a child's own school report.
    if (b.note) {
      withA(ctx, A(o, 1.0), 20 * u, () => txt(ctx, String(b.note).toUpperCase(), x0, 368 * u, { size: 18 * u, w: 600, color: MUTED, ls: 2.6 * u, align: 'left', maxW: span }));
    }

    const rows = (b.rows || []).slice(0, b.layout === 'cards' ? 8 : 9);
    if (!rows.length) {
      withA(ctx, A(o, 1.2), 30 * u, () => txt(ctx, 'Standings refresh shortly', W / 2, 660 * u, { size: 46 * u, w: 600, color: SOFT }));
      withA(ctx, A(o, 2.0), 20 * u, () => ctaStrip(ctx, W, H, u, o));
      return;
    }
    // A coin total reads better as a face than as a table row, so the coin boards lay their
    // students out as tiles. There are no student photographs anywhere in the rewards database,
    // so each tile carries a monogram disc rather than a stock face — a placeholder portrait
    // against a real child's name would be worse than no portrait at all.
    if (b.layout === 'cards') {
      const cols = 4, gap = 26 * u;
      const cw = (span - gap * (cols - 1)) / cols;
      const chh = 250 * u, topC = 404 * u;
      rows.forEach((r, i) => {
        const cx = x0 + (i % cols) * (cw + gap), cy = topC + Math.floor(i / cols) * (chh + gap);
        withA(ctx, A(o, 1.15 + i * 0.08), 26 * u, () => {
          ctx.save(); ctx.globalAlpha *= 0.12; ctx.fillStyle = '#ffffff';
          rr(ctx, cx, cy, cw, chh, 18 * u); ctx.fill(); ctx.restore();
          const dr = 46 * u, dcx = cx + cw / 2, dcy = cy + 62 * u;
          const initials = String(r.name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
          if (r.photo && r.photo.width) {
            ctx.save();
            ctx.beginPath(); ctx.arc(dcx, dcy, dr, 0, Math.PI * 2); ctx.clip();
            const sc = Math.max((dr * 2) / r.photo.width, (dr * 2) / r.photo.height);
            const pw = r.photo.width * sc, ph = r.photo.height * sc;
            // Nudged up a touch: a square crop of a portrait frames better on the eyes than dead centre.
            ctx.drawImage(r.photo, dcx - pw / 2, dcy - ph / 2 - ph * 0.04, pw, ph);
            ctx.restore();
            ctx.save(); ctx.beginPath(); ctx.arc(dcx, dcy, dr, 0, Math.PI * 2);
            ctx.strokeStyle = accent; ctx.lineWidth = 3 * u; ctx.globalAlpha *= 0.9; ctx.stroke(); ctx.restore();
          } else {
            ctx.save(); ctx.fillStyle = accent; ctx.globalAlpha *= 0.9;
            ctx.beginPath(); ctx.arc(dcx, dcy, dr, 0, Math.PI * 2); ctx.fill(); ctx.restore();
            txt(ctx, initials, dcx, dcy, { size: 42 * u, w: 800, color: NAVY3 });
          }
          if (r.rank <= 3) {
            ctx.save(); ctx.fillStyle = NAVY3; ctx.globalAlpha *= 0.92;
            ctx.beginPath(); ctx.arc(dcx + dr * 0.78, dcy - dr * 0.72, 17 * u, 0, Math.PI * 2); ctx.fill(); ctx.restore();
            txt(ctx, String(r.rank), dcx + dr * 0.78, dcy - dr * 0.72, { size: 19 * u, w: 800, color: accent });
          }
          txt(ctx, r.name || '', dcx, cy + 148 * u, { size: 30 * u, w: 700, maxW: cw - 22 * u });
          txt(ctx, String(r.value), dcx, cy + 198 * u, { size: 52 * u, fam: SERIF, color: accent });
          txt(ctx, (b.unit || '').toUpperCase(), dcx, cy + 228 * u, { size: 18 * u, w: 700, color: MUTED, ls: 2.4 * u });
        });
      });
      withA(ctx, A(o, 1.15 + rows.length * 0.08 + 0.3), 20 * u, () => ctaStrip(ctx, W, H, u, o));
      return;
    }
    // Rows stop above the CTA strip, which starts at H - 154u.
    const top = 392 * u, bottom = 902 * u;
    const rowH = Math.min(78 * u, (bottom - top) / rows.length);
    rows.forEach((r, i) => {
      const y = top + rowH * i + rowH / 2;
      withA(ctx, A(o, 1.15 + i * 0.1), 24 * u, () => {
        if (i % 2 === 0) {
          ctx.save(); ctx.globalAlpha *= 0.12; ctx.fillStyle = '#ffffff';
          rr(ctx, x0, y - rowH * 0.43, span, rowH * 0.86, 10 * u); ctx.fill(); ctx.restore();
        }
        ctx.save(); ctx.fillStyle = accent;
        ctx.beginPath(); ctx.arc(x0 + 38 * u, y, Math.min(26 * u, rowH * 0.36), 0, Math.PI * 2); ctx.fill(); ctx.restore();
        txt(ctx, String(r.rank), x0 + 38 * u, y, { size: Math.min(28 * u, rowH * 0.38), w: 800, color: NAVY3 });
        txt(ctx, r.name || '', x0 + 92 * u, y, { size: Math.min(46 * u, rowH * 0.62), w: 700, align: 'left', maxW: span * 0.48 });
        txt(ctx, r.cls || '', x0 + span * 0.62, y, { size: Math.min(32 * u, rowH * 0.44), w: 600, color: SOFT, align: 'left', maxW: span * 0.15 });
        const unit = b.unit || '';
        const vSize = Math.min(52 * u, rowH * 0.68);
        const uSize = Math.min(24 * u, rowH * 0.32);
        const uw = unit ? measure(ctx, unit, 700, uSize, SANS) + 14 * u : 0;
        txt(ctx, String(r.value), x1 - uw, y, { size: vSize, fam: SERIF, color: accent, align: 'right' });
        if (unit) txt(ctx, unit, x1, y + 2 * u, { size: uSize, w: 700, color: MUTED, align: 'right' });
      });
    });
    withA(ctx, A(o, 1.15 + rows.length * 0.1 + 0.3), 20 * u, () => ctaStrip(ctx, W, H, u, o));
  }

  function drawBoard(ctx, format, b, o = {}) {
    BGP = o.bgPhoto || null;
    const f = FORMATS[format] || FORMATS.landscape;
    ctx.save();
    ctx.globalAlpha = o.t == null ? 1 : ease((o.t * (o.speed || 1)) / 0.5);
    drawBoardLandscape(ctx, f.w, f.h, b, o);
    ctx.restore();
  }

  function drawStudent(ctx, format, s, o = {}) {
    BGP = o.bgPhoto || null;
    const f = FORMATS[format] || FORMATS.portrait;
    ctx.save();
    ctx.globalAlpha = o.t == null ? 1 : ease((o.t * (o.speed || 1)) / 0.5);
    if (format === 'landscape') drawLandscape(ctx, f.w, f.h, s, o);
    else if (format === 'square') drawSquare(ctx, f.w, f.h, s, o);
    else drawTall(ctx, f.w, f.h, s, o);
    ctx.restore();
  }

  function recapKicker(list, o) {
    const exams = [...new Set(list.map((a) => a.exam).filter(Boolean))];
    const cls = [...new Set(list.map((a) => a.cls).filter(Boolean))];
    const minPct = o.minPct == null ? 80 : o.minPct;
    return ((exams.length === 1 ? exams[0] : 'Results') + (cls.length === 1 ? ` · ${cls[0]}` : '') + ` · ${minPct}%+`).toUpperCase();
  }
  function drawRecap(ctx, format, list, o = {}) {
    BGP = o.bgPhoto || null;
    const f = FORMATS[format] || FORMATS.portrait, W = f.w, H = f.h;
    if (format === 'landscape') {
      const u = W / 1920;
      bg(ctx, W, H, 0.5, 0.3); frame(ctx, W, H, u, A(o, 0.1, 0.9));
      withA(ctx, A(o, 0.3), 30 * u, () => txt(ctx, recapKicker(list, o), 150 * u, 168 * u, { size: 24 * u, w: 800, color: GOLD, ls: 8 * u, align: 'left' }));
      withA(ctx, A(o, 0.5), 40 * u, () => txt(ctx, 'Our Toppers', 150 * u, 262 * u, { size: 124 * u, fam: SERIF, italic: true, align: 'left' }));
      withA(ctx, A(o, 0.4), 20 * u, () => logo(ctx, o.logo, 1770 * u, 250 * u, 62 * u, 'right'));
      if (list.length && list.length <= 4) {
        const n = list.length, cw = Math.min(470 * u, (1620 * u - 30 * u * (n - 1)) / n), ch = 560 * u, sx = (W - (cw * n + 30 * u * (n - 1))) / 2, sy = 345 * u;
        list.forEach((a, i) => withA(ctx, A(o, 0.9 + i * 0.18), 36 * u, () => {
          const x = sx + i * (cw + 30 * u), cx0 = x + cw / 2, first = i === 0;
          ctx.save(); rr(ctx, x, sy, cw, ch, 22 * u); ctx.fillStyle = 'rgba(255,255,255,.09)'; ctx.fill();
          ctx.strokeStyle = first ? 'rgba(245,184,61,.85)' : 'rgba(245,184,61,.4)'; ctx.lineWidth = (first ? 2.5 : 1.5) * u; ctx.stroke(); ctx.restore();
          if (first) txt(ctx, '#1 TOPPER', cx0, sy + 40 * u, { size: 20 * u, w: 800, color: GOLD, ls: 5 * u });
          photo(ctx, cx0, sy + 70 * u + 105 * u, 210 * u, a.photo, a.initials);
          const nl = nameLayout(ctx, a.name, 44 * u, cw - 50 * u, true);
          let ty = sy + 330 * u;
          nl.lines.forEach((ln, j) => txt(ctx, ln, cx0, ty + j * nl.size * 1.05, { size: nl.size, fam: SERIF }));
          ty += nl.lines.length * nl.size * 1.05;
          txt(ctx, [a.cls, a.subjects && a.subjects.length > 1 ? a.best : a.subject].filter(Boolean).join(' · '), cx0, ty + 4 * u, { size: 19 * u, w: 600, color: SOFT, maxW: cw - 40 * u });
          txt(ctx, a.pct + '%', cx0, sy + ch - 62 * u, { size: 92 * u, fam: SERIF, color: GOLD });
        }));
      }
      const items = list.length <= 4 ? [] : list.slice(0, 8), cols = 4, kk = items.length <= 3 ? 1.3 : 1, cw = (1620 * u - 72 * u) / 4 * kk, ch = (items.length <= 4 ? 380 : 270) * u, rows = Math.ceil(items.length / cols);
      const gy = 24 * u, areaTop = 350 * u, areaH = 560 * u, startY = areaTop + (areaH - (rows * ch + (rows - 1) * gy)) / 2;
      items.forEach((a, i) => {
        const r = Math.floor(i / cols), inRow = Math.min(cols, items.length - r * cols), col = i % cols;
        const rowW = inRow * cw + (inRow - 1) * 24 * u, x = (W - rowW) / 2 + col * (cw + 24 * u), y = startY + r * (ch + gy);
        withA(ctx, A(o, 0.9 + i * 0.15), 36 * u, () => {
          ctx.save(); ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(x, y, cw, ch);
          ctx.strokeStyle = 'rgba(245,184,61,.35)'; ctx.lineWidth = 1.5 * u; ctx.strokeRect(x, y, cw, ch); ctx.restore();
          const pd = 30 * u * kk, pdm = 112 * u * kk;
          photo(ctx, x + pd + pdm / 2, y + pd + pdm / 2, pdm, a.photo, a.initials);
          txt(ctx, a.pct + '%', x + cw - pd, y + pd + pdm / 2, { size: 76 * u * kk, fam: SERIF, color: GOLD, align: 'right' });
          const nl = nameLayout(ctx, a.name, 38 * u * kk, cw - pd * 2, true);
          const ny = y + pd + pdm + 44 * u;
          nl.lines.forEach((ln, j) => txt(ctx, ln, x + pd, ny + j * nl.size * 1.08, { size: nl.size, fam: SERIF, align: 'left' }));
          txt(ctx, [a.cls, subjExam(a)].filter(Boolean).join(' · '), x + pd, ny + nl.lines.length * nl.size * 1.08 + 10 * u, { size: 21 * u * kk, w: 600, color: SOFT, align: 'left', maxW: cw - pd * 2 });
        });
      });
      withA(ctx, A(o, 1.4), 10 * u, () => {
        txt(ctx, list.length > 8 ? `+${list.length - 8} MORE ACHIEVERS` : `${list.length} ACHIEVER${list.length === 1 ? '' : 'S'}`, 150 * u, 965 * u, { size: 22 * u, w: 700, color: MUTED, ls: 4.4 * u, align: 'left' });
        txt(ctx, (o.contact || '').toUpperCase(), 1770 * u, 965 * u, { size: 22 * u, w: 700, color: MUTED, ls: 4.4 * u, align: 'right' });
      });
      return;
    }
    const u = W / 1080, story = format === 'story', sq = format === 'square', cx = W / 2;
    const max = story ? 7 : sq ? 4 : 6, items = list.slice(0, max);
    const pt = (story ? 150 : sq ? 64 : 70) * u, pb = ((story ? 130 : 40) + STRIP) * u;
    bg(ctx, W, H, 0.5, 0.3); frame(ctx, W, H, u, A(o, 0.1, 0.9));
    let y = 50 * u + pt;
    const lh = (sq ? 52 : 62) * u;
    withA(ctx, A(o, 0.3), 20 * u, () => logo(ctx, o.logo, cx, y + lh / 2, lh, 'center'));
    y += lh + (sq ? 34 : 50) * u;
    withA(ctx, A(o, 0.4), 30 * u, () => txt(ctx, recapKicker(list, o), cx, y, { size: (sq ? 18 : 22) * u, w: 800, color: GOLD, ls: 6 * u, maxW: W - 240 * u }));
    y += (sq ? 66 : 84) * u;
    withA(ctx, A(o, 0.6), 40 * u, () => txt(ctx, 'Our Toppers', cx, y, { size: (story ? 130 : sq ? 88 : 108) * u, fam: SERIF, italic: true }));
    y += (story ? 120 : sq ? 80 : 100) * u;
    const footY = H - 50 * u - pb;
    const areaTop = y - 10 * u, areaH = footY - 30 * u - areaTop, X0 = 110 * u, X1 = W - 110 * u, gap = 22 * u;
    const n = items.length;
    if (n === 0) {
      txt(ctx, 'Results coming soon', cx, areaTop + areaH / 2, { size: 54 * u, fam: SERIF, italic: true, color: SOFT });
    } else if (n <= 4) {
      // Hero card for the top scorer, the rest side by side underneath.
      const rows = n <= 1 ? 1 : 2, heroH = n <= 1 ? areaH : (areaH - gap) * 0.56, restH = areaH - heroH - gap;
      const card = (a, x, yy, w, h, hero, k) => withA(ctx, A(o, 0.9 + k * 0.18), 36 * u, () => {
        ctx.save(); rr(ctx, x, yy, w, h, 22 * u); ctx.fillStyle = 'rgba(255,255,255,.09)'; ctx.fill();
        ctx.strokeStyle = hero ? 'rgba(245,184,61,.85)' : 'rgba(245,184,61,.4)'; ctx.lineWidth = (hero ? 2.5 : 1.5) * u; ctx.stroke(); ctx.restore();
        if (hero) {
          const d = Math.min(h * 0.62, w * 0.36), cx0 = x + 40 * u + d / 2, cy0 = yy + h / 2;
          photo(ctx, cx0, cy0, d, a.photo, a.initials);
          const tx = cx0 + d / 2 + 40 * u, tw = x + w - 40 * u - tx;
          txt(ctx, '#1 TOPPER', tx, cy0 - h * 0.28, { size: 22 * u, w: 800, color: GOLD, ls: 5 * u, align: 'left' });
          const nl = nameLayout(ctx, a.name, Math.min(64 * u, h * 0.16), tw, true);
          const nTop = cy0 - h * 0.17;
          nl.lines.forEach((ln, j) => txt(ctx, ln, tx, nTop + nl.size * 0.54 + j * nl.size * 1.05, { size: nl.size, fam: SERIF, align: 'left' }));
          const after = nTop + nl.lines.length * nl.size * 1.05 + 18 * u;
          txt(ctx, [a.cls, subjExam(a)].filter(Boolean).join(' · '), tx, after + 12 * u, { size: 22 * u, w: 600, color: SOFT, align: 'left', maxW: tw });
          txt(ctx, a.pct + '%', tx, after + 12 * u + Math.min(110 * u, h * 0.22), { size: Math.min(120 * u, h * 0.26), fam: SERIF, color: GOLD, align: 'left' });
        } else {
          const d = Math.min(h * 0.42, w * 0.42), cx0 = x + w / 2, cy0 = yy + 28 * u + d / 2;
          photo(ctx, cx0, cy0, d, a.photo, a.initials);
          const nl = nameLayout(ctx, a.name, Math.min(40 * u, h * 0.11), w - 40 * u, true);
          let ty = cy0 + d / 2 + 24 * u + nl.size * 0.5;
          nl.lines.forEach((ln, j) => txt(ctx, ln, cx0, ty + j * nl.size * 1.05, { size: nl.size, fam: SERIF }));
          ty += nl.lines.length * nl.size * 1.05 + 4 * u;
          txt(ctx, a.cls || a.school || '', cx0, ty, { size: 20 * u, w: 600, color: SOFT, maxW: w - 40 * u });
          const ps = Math.min(76 * u, h * 0.17);
          txt(ctx, a.pct + '%', cx0, Math.max(ty + 20 * u + ps * 0.6, yy + h - 26 * u - ps * 0.5), { size: ps, fam: SERIF, color: GOLD });
        }
      });
      card(items[0], X0, areaTop, X1 - X0, heroH, true, 0);
      const rest = items.slice(1), cw = rest.length ? (X1 - X0 - gap * (rest.length - 1)) / rest.length : 0;
      rest.forEach((a, k) => card(a, X0 + k * (cw + gap), areaTop + heroH + gap, cw, restH, false, k + 1));
    } else {
      const rowH = areaH / n, x0 = X0, x1 = X1, d = rowH * 0.72;
      items.forEach((a, i) => {
        const ry = areaTop + i * rowH + rowH / 2;
        withA(ctx, A(o, 0.9 + i * 0.15), 30 * u, () => {
          if (i) { ctx.save(); ctx.fillStyle = 'rgba(245,184,61,.25)'; ctx.fillRect(x0, ry - rowH / 2, x1 - x0, 1 * u); ctx.restore(); }
          photo(ctx, x0 + d / 2, ry, d, a.photo, a.initials);
          const tx = x0 + d + 30 * u, pw = measure(ctx, '100%', 400, rowH * 0.42, SERIF);
          txt(ctx, a.name, tx, ry - rowH * 0.13, { size: rowH * 0.27, fam: SERIF, align: 'left', maxW: x1 - tx - pw - 30 * u });
          txt(ctx, [a.cls, subjExam(a)].filter(Boolean).join(' · '), tx, ry + rowH * 0.19, { size: rowH * 0.15, w: 600, color: SOFT, align: 'left', maxW: x1 - tx - pw - 30 * u });
          txt(ctx, a.pct + '%', x1, ry, { size: rowH * 0.42, fam: SERIF, color: GOLD, align: 'right' });
        });
      });
    }
    withA(ctx, A(o, 1.4), 10 * u, () => { if (list.length > max) txt(ctx, `+${list.length - max} MORE TOPPERS`, cx, footY - 10 * u, { size: (sq ? 18 : 22) * u, w: 700, color: SOFT, ls: 4 * u }); ctaStrip(ctx, W, H, u, o); });
  }

  function rand(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function sparkle(ctx, W, H, t, a) {
    if (a <= 0) return;
    const u = W / 1080;
    ctx.save();
    for (let i = 0; i < 34; i++) {
      const sp = 20 + rand(i + 3) * 50, size = (2 + rand(i + 7) * 4) * u;
      const x = rand(i) * W, y = ((rand(i + 1) * H - t * sp * u) % H + H) % H;
      ctx.globalAlpha = a * (0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2.2 + i)));
      ctx.fillStyle = GOLD; ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  function endCard(ctx, W, H, o, lt) {
    BGP = o.bgPhoto || null;
    const u = W / 1080, cx = W / 2, oo = { t: lt };
    bg(ctx, W, H, 0.5, 0.45); frame(ctx, W, H, u, 1);
    withA(ctx, A(oo, 0.1), 30 * u, () => logo(ctx, o.logo, cx, H * 0.42, 120 * u, 'center'));
    withA(ctx, A(oo, 0.4), 20 * u, () => { ctx.save(); ctx.fillStyle = GOLD; ctx.fillRect(cx - 60 * u, H * 0.42 + 120 * u, 120 * u, 3 * u); ctx.restore(); });
    const parts = String(o.contact || '').split('·').map((x) => x.trim()).filter(Boolean);
    withA(ctx, A(oo, 0.5), 20 * u, () => txt(ctx, o.endLine || 'Your child could be next.', cx, H * 0.42 - 230 * u, { size: 76 * u, fam: SERIF, italic: true, maxW: W - 200 * u }));
    withA(ctx, A(oo, 0.6), 20 * u, () => txt(ctx, (o.cta || 'Admissions open · Book a free demo class').toUpperCase(), cx, H * 0.42 + 205 * u, { size: 30 * u, w: 800, color: GOLD, ls: 3 * u, maxW: W - 200 * u }));
    parts.forEach((p, i) => withA(ctx, A(oo, 0.75 + i * 0.15), 20 * u, () => txt(ctx, p.toUpperCase(), cx, H * 0.42 + 290 * u + i * 64 * u, { size: 34 * u, w: 700, color: i ? SOFT : '#fff', ls: 6 * u, maxW: W - 200 * u })));
  }

  const END_LINES = [
    'Your child could be next.', 'Toppers are made here.', 'Hard work. Big results.', 'Dream big. Score bigger.',
    'Every star starts somewhere.', 'Results that speak for themselves.', 'Big dreams start in our classrooms.', 'Next topper? Maybe yours.',
  ];
  const hash = (str) => { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const pick = (arr, key) => arr[hash(key) % arr.length];
  const endLineFor = (s) => (s ? pick(END_LINES, s.key || s.name) : 'Toppers are made here.');

  // ---------- music: generated in the browser (royalty-free), 15 s arrangement ----------
  const MOODS = {
    celebration: { label: 'Celebration', bpm: 124, prog: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]], bass: [36, 31, 33, 29], wave: 'square', soft: false },
    inspiring: { label: 'Inspiring', bpm: 96, prog: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], bass: [33, 29, 36, 31], wave: 'triangle', soft: true },
    upbeat: { label: 'Upbeat', bpm: 116, prog: [[53, 57, 60], [48, 52, 55], [55, 59, 62], [57, 60, 64]], bass: [29, 36, 31, 33], wave: 'sawtooth', soft: false },
    desi: { label: 'Desi Beat', bpm: 100, prog: [[62, 65, 69], [60, 64, 67], [58, 62, 65], [60, 64, 67]], bass: [38, 36, 34, 36], wave: 'triangle', soft: false, drums: 'dhol' },
    cinematic: { label: 'Cinematic', bpm: 80, prog: [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]], bass: [33, 29, 31, 28], wave: 'sine', soft: true, drums: 'cine', arp: false },
    lofi: { label: 'Lo-fi Chill', bpm: 84, prog: [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65]], bass: [36, 33, 29, 31], wave: 'triangle', soft: true, drums: 'lofi' },
  };
  const MOOD_KEYS = Object.keys(MOODS);
  const moodFor = (s) => pick(MOOD_KEYS, 'm' + (s ? s.key || s.name : 'recap'));
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function scheduleMusic(ac, out, t0, mood, seconds = REEL_SECONDS) {
    const M = MOODS[mood] || MOODS.celebration, beat = 60 / M.bpm, bar = beat * 4, end = t0 + seconds;
    const master = ac.createGain(), comp = ac.createDynamicsCompressor();
    master.gain.setValueAtTime(0.0001, t0); master.gain.exponentialRampToValueAtTime(0.75, t0 + 0.4);
    master.gain.setValueAtTime(0.75, Math.max(t0 + 0.5, end - 1.6)); master.gain.exponentialRampToValueAtTime(0.0001, end - 0.05);
    master.connect(comp); comp.connect(out);
    const nb = ac.createBuffer(1, ac.sampleRate, ac.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const nodes = [];
    const tone = (f, t, dur, type, vol, attack = 0.005, dest = master) => {
      if (t >= end) return;
      const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05); nodes.push(o);
    };
    const noise = (t, dur, vol, type, freq, q = 1) => {
      if (t >= end) return;
      const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = nb; f.type = type; f.frequency.value = freq; f.Q.value = q;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + dur + 0.05); nodes.push(src);
    };
    const kick = (t) => {
      if (t >= end) return;
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
      g.gain.setValueAtTime(M.soft ? 0.55 : 0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.4); nodes.push(o);
    };
    const padBus = ac.createBiquadFilter(); padBus.type = 'lowpass'; padBus.frequency.value = 1400; padBus.connect(master);
    const drop = t0 + Math.max(bar, Math.round(3 / bar) * bar), outro = t0 + 12.4;
    // riser into the score reveal
    const rs = ac.createBufferSource(), rf = ac.createBiquadFilter(), rg = ac.createGain();
    rs.buffer = nb; rs.loop = true; rf.type = 'highpass'; rf.frequency.setValueAtTime(300, drop - 1.6); rf.frequency.exponentialRampToValueAtTime(7000, drop);
    rg.gain.setValueAtTime(0.0001, drop - 1.6); rg.gain.exponentialRampToValueAtTime(0.18, drop - 0.02); rg.gain.setValueAtTime(0.0001, drop);
    rs.connect(rf); rf.connect(rg); rg.connect(master); rs.start(drop - 1.6); rs.stop(drop + 0.05); nodes.push(rs);
    noise(drop, 1.4, 0.28, 'highpass', 3500); // crash
    [84, 88, 91, 96].forEach((m, i) => tone(hz(m), drop + i * beat / 2, 0.9, 'sine', 0.07)); // sparkle
    for (let b = 0, t = t0; t < outro; b++, t += bar) {
      const ch = M.prog[b % 4], bs = M.bass[b % 4], barEnd = Math.min(t + bar, outro);
      ch.forEach((m) => { tone(hz(m), t, barEnd - t + 0.3, 'sawtooth', 0.025, 0.25, padBus); tone(hz(m) * 1.005, t, barEnd - t + 0.3, 'sawtooth', 0.02, 0.25, padBus); });
      if (M.arp === false) tone(hz(ch[2] + 12), t, bar * 0.9, 'sine', 0.06, 0.02);
      else for (let i = 0; i < 8; i++) {
        const tt = t + i * beat / 2; if (tt >= outro) break;
        const m = ch[[0, 1, 2, 1, 0, 2, 1, 2][i]] + 12 + (i === 6 ? 12 : 0);
        tone(hz(m), tt, M.soft ? 0.5 : 0.22, M.wave, M.soft ? 0.05 : 0.035);
      }
      if (t >= drop - 0.01 && M.drums) {
        for (let i = 0; i < 8; i++) {
          const tt = t + i * beat / 2; if (tt >= outro) break;
          if (M.drums === 'dhol') {
            const low = [1, 0, 0, 1, 0, 1, 0, 0][i];
            if (low) { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.setValueAtTime(95, tt); o.frequency.exponentialRampToValueAtTime(55, tt + 0.22); g.gain.setValueAtTime(0.75, tt); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.32); o.connect(g); g.connect(master); o.start(tt); o.stop(tt + 0.35); nodes.push(o); }
            else { noise(tt, 0.07, 0.32, 'bandpass', 2300, 3); tone(520, tt, 0.08, 'sine', 0.07); }
            if (i % 2 === 0) tone(hz(bs + 12), tt, beat * 0.45, 'triangle', 0.14);
          } else if (M.drums === 'lofi') {
            if (i === 0 || i === 5) kick(tt);
            if (i === 2 || i === 6) noise(tt, 0.22, 0.16, 'bandpass', 1200, 0.7);
            noise(tt, 0.04, 0.04, 'highpass', 7000);
            if (i === 0) { noise(tt, bar, 0.012, 'bandpass', 3000, 0.5); tone(hz(bs), tt, bar * 0.95, 'sine', 0.2, 0.05); }
          } else if (M.drums === 'cine') {
            if (i === 0 || i === 5) { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.setValueAtTime(70, tt); o.frequency.exponentialRampToValueAtTime(32, tt + 0.6); g.gain.setValueAtTime(i ? 0.6 : 1, tt); g.gain.exponentialRampToValueAtTime(0.0001, tt + 1.3); o.connect(g); g.connect(master); o.start(tt); o.stop(tt + 1.35); nodes.push(o); noise(tt, 1.2, 0.18, 'lowpass', 500); }
            if (i === 0) tone(hz(bs), tt, bar, 'sawtooth', 0.06, 0.3, padBus);
          }
        }
      } else if (t >= drop - 0.01) {
        for (let i = 0; i < 4; i++) {
          const tt = t + i * beat; if (tt >= outro) break;
          if (!M.soft || i % 2 === 0) kick(tt);
          if (i % 2 === 1) noise(tt, M.soft ? 0.25 : 0.16, M.soft ? 0.18 : 0.32, 'bandpass', 1600, 0.8);
          noise(tt + beat / 2, 0.05, 0.1, 'highpass', 8000);
          tone(hz(bs), M.soft ? tt : tt + beat / 2, beat * (M.soft ? 0.9 : 0.45), 'triangle', 0.22);
        }
      } else tone(hz(bs), t, bar, 'triangle', 0.12, 0.3);
    }
    // closing chord under the end card
    M.prog[0].forEach((m) => { tone(hz(m), outro, end - outro, 'sawtooth', 0.03, 0.4, padBus); tone(hz(m + 12), outro, end - outro, 'sine', 0.05, 0.02); });
    kick(outro); noise(outro, 2, 0.22, 'highpass', 3500);
    return { stop() { const now = ac.currentTime; try { master.gain.cancelScheduledValues(now); master.gain.setValueAtTime(master.gain.value, now); master.gain.linearRampToValueAtTime(0, now + 0.08); } catch (e) {} setTimeout(() => { nodes.forEach((n) => { try { n.stop(); } catch (e) {} }); master.disconnect(); }, 150); } };
  }

  function playTrack(ac, out, t0, buffer, offset = 0, seconds = REEL_SECONDS) {
    const src = ac.createBufferSource(), g = ac.createGain(), end = t0 + seconds; src.buffer = buffer;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.9, t0 + 0.4);
    g.gain.setValueAtTime(0.9, Math.max(t0 + 0.5, end - 1.5)); g.gain.exponentialRampToValueAtTime(0.0001, end - 0.05);
    src.connect(g); g.connect(out); src.start(t0, Math.max(0, Math.min(offset, buffer.duration - 1))); src.stop(end);
    return { stop() { try { const n = ac.currentTime; g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(0, n + 0.04); src.stop(n + 0.06); } catch (e) {} } };
  }
  async function decodeTrack(file) { const ac = new (window.AudioContext || window.webkitAudioContext)(); const b = await ac.decodeAudioData(await file.arrayBuffer()); ac.close(); return b; }
  // Finds the loudest 15 s stretch (usually the chorus) so the reel starts on the hook.
  function findHook(buffer, seconds = REEL_SECONDS) {
    const d = buffer.getChannelData(0), sr = buffer.sampleRate, win = sr, e = [];
    for (let i = 0; i + win <= d.length; i += win) { let s2 = 0; for (let j = i; j < i + win; j += 16) s2 += d[j] * d[j]; e.push(s2); }
    let best = 0, bestV = -1; const w = Math.min(seconds, e.length);
    for (let i = 0; i + w <= e.length; i++) { let v = 0; for (let k = 0; k < w; k++) v += e[i + k]; if (v > bestV) { bestV = v; best = i; } }
    return best;
  }

  function reelStudent(ctx, s, t, o = {}) {
    o = { endLine: endLineFor(s), ...o };
    const W = 1080, H = 1920, out = t > 12.4 ? ease((t - 12.4) / 0.8) : 0;
    ctx.clearRect(0, 0, W, H);
    if (out < 1) { drawStudent(ctx, 'story', s, { ...o, t }); sparkle(ctx, W, H, t, ease((t - 4) / 1.5)); }
    if (out > 0) { ctx.save(); ctx.globalAlpha = out; endCard(ctx, W, H, o, t - 12.4); ctx.restore(); }
  }
  function reelRecap(ctx, list, t, o = {}) {
    o = { endLine: endLineFor(null), ...o };
    const W = 1080, H = 1920, u = 1, items = list.slice(0, 8), n = Math.max(items.length, 1);
    ctx.clearRect(0, 0, W, H);
    const introEnd = 2.6, outStart = 12.4, slot = (outStart - introEnd) / n;
    const drawIntro = (lt) => {
      BGP = o.bgPhoto || null;
      const oo = { t: lt };
      bg(ctx, W, H, 0.5, 0.42); frame(ctx, W, H, u, A(oo, 0.1, 0.9));
      withA(ctx, A(oo, 0.2), 20, () => logo(ctx, o.logo, W / 2, 260, 76, 'center'));
      withA(ctx, A(oo, 0.4), 30, () => txt(ctx, recapKicker(list, o), W / 2, 820, { size: 26, w: 800, color: GOLD, ls: 8, maxW: 860 }));
      withA(ctx, A(oo, 0.6), 40, () => txt(ctx, 'Our Toppers', W / 2, 950, { size: 150, fam: SERIF, italic: true, maxW: 900 }));
      withA(ctx, A(oo, 0.9), 30, () => txt(ctx, `${list.length} star student${list.length === 1 ? '' : 's'}`, W / 2, 1090, { size: 44, w: 700, color: SOFT }));
      sparkle(ctx, W, H, lt, A(oo, 0.5, 1));
    };
    const speed = Math.max(1.6, 4.6 / (slot * 0.45));
    if (t < introEnd) drawIntro(t);
    else if (t < outStart || true) {
      const i = Math.min(n - 1, Math.floor((t - introEnd) / slot)), lt = t - introEnd - i * slot;
      if (t < outStart + 0.8) {
        if (lt < 0.35) { if (i > 0) drawStudent(ctx, 'story', items[i - 1], { ...o }); else drawIntro(introEnd); }
        ctx.save(); ctx.globalAlpha = lt < 0.35 ? ease(lt / 0.35) : 1;
        drawStudent(ctx, 'story', items[i] || {}, { ...o, t: Math.max(0.5 / speed, lt), speed });
        ctx.restore();
        sparkle(ctx, W, H, t, 0.8);
      }
    }
    if (t > outStart) { ctx.save(); ctx.globalAlpha = ease((t - outStart) / 0.8); endCard(ctx, W, H, o, t - outStart); ctx.restore(); }
  }

  async function ready() {
    if (!document.fonts) return;
    await Promise.all([
      document.fonts.load(`400 80px "DM Serif Display"`), document.fonts.load(`italic 400 80px "DM Serif Display"`),
      document.fonts.load(`800 40px "Manrope"`), document.fonts.load(`700 40px "Manrope"`), document.fonts.load(`600 40px "Manrope"`),
    ].map((p) => p.catch(() => {})));
  }
  function loadImage(url) {
    return new Promise((res) => {
      if (!url) return res(null);
      const im = new Image(); im.crossOrigin = 'anonymous'; im.referrerPolicy = 'no-referrer';
      im.onload = () => res(im); im.onerror = () => res(null); im.src = url;
    });
  }
  function pickMime(audio) {
    const c = audio ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'] : ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    return c.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  }
  // Renders drawFrame(ctx, t) in real time and returns the recorded video.
  function record(drawFrame, { w = 1080, h = 1920, seconds = REEL_SECONDS, fps = 30, onProgress, music } = {}) {
    return new Promise((resolve, reject) => {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d'); drawFrame(ctx, 0);
      const mime = pickMime(!!music);
      if (!mime) return reject(new Error('This browser can’t record video. Use Chrome or Edge.'));
      const stream = cv.captureStream(fps);
      let ac = null, dest = null;
      if (music) { ac = new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); dest = ac.createMediaStreamDestination(); dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr)); }
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 10000000, audioBitsPerSecond: 192000 });
      const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => { if (ac) ac.close(); }; rec.addEventListener('stop', () => resolve({ blob: new Blob(chunks, { type: mime.split(';')[0] }), ext: mime.includes('mp4') ? 'mp4' : 'webm' }));
      rec.start(250);
      if (music) (music.buffer ? playTrack(ac, dest, ac.currentTime + 0.02, music.buffer, music.offset, seconds) : scheduleMusic(ac, dest, ac.currentTime + 0.02, music, seconds));
      const t0 = performance.now();
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        drawFrame(ctx, Math.min(t, seconds));
        onProgress && onProgress(Math.min(1, t / seconds));
        if (t < seconds) setTimeout(tick, 1000 / fps); else setTimeout(() => rec.stop(), 200);
      };
      tick();
    });
  }

  // One entry per student per test: overall % across subjects, subjects listed best-first.
  function parseDate(d) { const m = String(d || '').match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/); if (!m) return 0; const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return new Date(y, +m[2] - 1, +m[1]).getTime(); }
  const SUBJ = [[/^maths?$|^mathematics|fraction|algebra|geometry|mensuration|integers|decimals/i, 'Mathematics'], [/^sst$|social\s*science|social\s*studies/i, 'Social Science'], [/^sci(ence)?\b|science\s*\(/i, 'Science'],
    [/^bio/i, 'Biology'], [/^chem/i, 'Chemistry'], [/^phy/i, 'Physics'], [/^eng/i, 'English'], [/^hin/i, 'Hindi'], [/^comp/i, 'Computer'], [/^sans/i, 'Sanskrit'], [/^ger/i, 'German']];
  const normSubject = (x, exam) => {
    const t = String(x || '').trim();
    for (const [re, n] of SUBJ) if (re.test(t)) return n;
    const m = t.match(/\(([^)]+)\)/); if (m) for (const [re, n] of SUBJ) if (re.test(m[1])) return n;
    if (!t || /^(class|unit|chapter|weekly|monthly)?\s*test|^mcq|multiple choice|^fac|^total$/i.test(t) || t.toLowerCase() === String(exam).toLowerCase()) return '';
    return t.replace(/\s*-\s*.*$/, '');
  };
  const normExam = (x) => String(x || '').trim().replace(/examination$/i, 'Exam').replace(/\s+/g, ' ').replace(/^term[\s-]*i\b/i, 'Term 1').replace(/^half[\s-]*yearly/i, 'Half-Yearly');
  function group(rows) {
    rows = rows.map((r) => ({ ...r, exam: normExam(r.exam), subjectRaw: r.subject, subject: normSubject(r.subject, r.exam) }));
    const map = new Map();
    rows.forEach((r) => {
      if (/verify|flag|review|test entry|dummy/i.test(r.exam + ' ' + r.name)) return;
      const k = (r.id || r.name) + '|' + r.exam;
      if (!map.has(k)) map.set(k, { ...r, key: k, subjects: [], sumM: 0, sumT: 0, date: r.date, ts: parseDate(r.date) });
      const g = map.get(k);
      if (/^(grand\s*)?total$|^overall$/i.test(String(r.subjectRaw).trim())) { g.overall = r; return; }
      const prev = r.subject && g.subjects.find((x) => x.subject === r.subject);
      if (prev) { if (r.pct > prev.pct) Object.assign(prev, { pct: r.pct, marks: r.marks, total: r.total }); const m0 = Number(r.marks), t0 = Number(r.total); if (!isNaN(m0) && t0 > 0) { g.sumM += m0; g.sumT += t0; } return; }
      g.subjects.push({ subject: r.subject, pct: r.pct, marks: r.marks, total: r.total });
      const m = Number(r.marks), t = Number(r.total);
      if (!isNaN(m) && !isNaN(t) && t > 0) { g.sumM += m; g.sumT += t; }
      g.ts = Math.max(g.ts, parseDate(r.date));
      if (!g.photoUrl && r.photoUrl) g.photoUrl = r.photoUrl;
    });
    return [...map.values()].filter((g) => g.subjects.length || g.overall).map((g) => {
      if (!g.subjects.length) g.subjects.push({ subject: g.overall.subject, pct: g.overall.pct, marks: g.overall.marks, total: g.overall.total });
      g.subjects.sort((a, b) => b.pct - a.pct);
      const n = g.subjects.length;
      let pct = g.sumT ? Math.round((g.sumM / g.sumT) * 100) : Math.round(g.subjects.reduce((a, b) => a + b.pct, 0) / n);
      const fromTotal = !!g.overall && !g.sumT;
      if (fromTotal) { pct = g.overall.pct; g.sumM = Number(g.overall.marks) || 0; g.sumT = Number(g.overall.total) || 0; }
      const fm = (x) => (Number.isInteger(x) ? String(x) : String(+x.toFixed(1)));
      const named = fromTotal ? [] : g.subjects.filter((x) => x.subject), k = named.length;
      const label = (x) => (x.subject.length > 22 ? x.subject.slice(0, 20).trim() + '…' : x.subject);
      return { ...g, pct, marks: g.sumT ? fm(g.sumM) : '', total: g.sumT ? fm(g.sumT) : '',
        subject: k > 1 ? `Overall · ${k} subjects` : k && g.subjects.length === k ? named[0].subject : '',
        best: named.slice(0, k > 3 ? 2 : 3).map((x) => `${label(x)} ${x.pct}%`).join(' · '),
        inSubj: k > 1 ? `overall across ${k} subjects` : k && g.subjects.length === k ? `in ${named[0].subject}` : 'overall' };
    });
  }
  function tests(list) {
    const m = new Map(); list.forEach((s) => m.set(s.exam, Math.max(m.get(s.exam) || 0, s.ts || 0)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  }

  window.QlassArt = { group, tests, MOODS, moodFor, scheduleMusic, playTrack, decodeTrack, findHook, endLineFor, FORMATS, REEL_SECONDS, ready, loadImage, drawStudent, drawRecap, drawBoard, reelStudent, reelRecap, record };
})();
