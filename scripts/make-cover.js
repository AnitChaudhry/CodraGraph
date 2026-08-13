/**
 * Builds the CodraGraph public-repo cover image.
 * 1280x640 logical canvas (GitHub social-preview ratio), rasterized at 2x.
 * Palette is taken straight from apps/web/src/index.css (dark theme).
 */
const fs = require('fs');
const path = require('path');
const sharp = require('D:/Thinqmesh Wesbite/thinqmesh-codragraph/node_modules/sharp');

const W = 1280;
const H = 640;
const SCALE = 2;
const OUT = 'D:/Thinqmesh Wesbite/thinqmesh-codragraph/branding/codragraph-cover.png';

const C = {
  void: '#06060a',
  surface: '#101018',
  elevated: '#16161f',
  borderSubtle: '#1e1e2a',
  border: '#2a2a3a',
  text: '#e4e4ed',
  textSecondary: '#8888a0',
  textMuted: '#5a5a70',
  accent: '#7c3aed',
  accentSoft: '#a78bfa',
  file: '#3b82f6',
  folder: '#6366f1',
  class: '#f59e0b',
  fn: '#10b981',
  iface: '#ec4899',
  method: '#14b8a6',
};

const SANS = 'Segoe UI, Inter, system-ui, sans-serif';
const MONO = 'Consolas, JetBrains Mono, Courier New, monospace';

const mark = fs.readFileSync(path.join(__dirname, 'mark-white.png')).toString('base64');

/* ── graph illustration ───────────────────────────────────────── */
const HUB = { x: 1010, y: 318, r: 15, c: C.accentSoft };
const ring = [
  { id: 'n1', x: 912, y: 188, r: 10, c: C.fn },
  { id: 'n2', x: 1108, y: 196, r: 10, c: C.class },
  { id: 'n3', x: 1152, y: 344, r: 10, c: C.file },
  { id: 'n4', x: 1064, y: 462, r: 10, c: C.iface },
  { id: 'n5', x: 900, y: 436, r: 10, c: C.method },
  { id: 'n6', x: 856, y: 296, r: 10, c: C.folder },
];
const outer = [
  { id: 'o1', x: 838, y: 116, r: 6, c: C.file },
  { id: 'o2', x: 1012, y: 104, r: 6, c: C.method },
  { id: 'o3', x: 1206, y: 240, r: 6, c: C.fn },
  { id: 'o4', x: 1224, y: 452, r: 6, c: C.file },
  { id: 'o5', x: 972, y: 552, r: 6, c: C.class },
  { id: 'o6', x: 816, y: 512, r: 6, c: C.fn },
  { id: 'o7', x: 762, y: 208, r: 6, c: C.iface },
  { id: 'o8', x: 1152, y: 556, r: 6, c: C.folder },
];
const byId = Object.fromEntries([...ring, ...outer].map((n) => [n.id, n]));
byId.hub = HUB;

const edges = [
  ...ring.map((n) => ['hub', n.id]),
  ['n1', 'o1'],
  ['n1', 'o2'],
  ['n2', 'o2'],
  ['n2', 'o3'],
  ['n3', 'o3'],
  ['n3', 'o4'],
  ['n4', 'o4'],
  ['n4', 'o5'],
  ['n5', 'o5'],
  ['n5', 'o6'],
  ['n6', 'o6'],
  ['n6', 'o7'],
  ['o1', 'n6'],
  ['n1', 'n2'],
  ['n3', 'n4'],
  ['n5', 'n6'],
  ['o8', 'n4'],
];
// one traced execution flow, drawn hot (kept clear of the left-edge fade)
const flow = [
  ['n5', 'n6'],
  ['n6', 'hub'],
  ['hub', 'n3'],
  ['n3', 'o4'],
];
const flowKeys = new Set(flow.map(([a, b]) => `${a}-${b}`));

const line = (a, b, stroke, width, opacity) =>
  `<line x1="${byId[a].x}" y1="${byId[a].y}" x2="${byId[b].x}" y2="${byId[b].y}" ` +
  `stroke="${stroke}" stroke-width="${width}" stroke-opacity="${opacity}" stroke-linecap="round"/>`;

const edgeSvg = edges
  .filter(([a, b]) => !flowKeys.has(`${a}-${b}`))
  .map(([a, b]) => line(a, b, '#343449', 1.5, 0.95))
  .join('\n    ');

const flowSvg = flow.map(([a, b]) => line(a, b, C.accentSoft, 2.6, 0.85)).join('\n    ');

const nodeSvg = [...outer, ...ring, HUB]
  .map((n) => {
    const hot = n === HUB || ['n5', 'n6', 'n3', 'o4'].includes(n.id);
    return (
      `<circle cx="${n.x}" cy="${n.y}" r="${n.r * 2.6}" fill="${n.c}" opacity="${hot ? 0.2 : 0.12}" filter="url(#soft)"/>` +
      `<circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="${n.c}"/>` +
      `<circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="none" stroke="${C.void}" stroke-width="2.5" stroke-opacity="0.55"/>`
    );
  })
  .join('\n    ');

/* ── left column ──────────────────────────────────────────────── */
const stats = [
  { v: '14', l: 'LANGUAGES' },
  { v: '32', l: 'AGENT SKILLS' },
  { v: '8\u00d7', l: 'LESS CONTEXT' },
  { v: '9', l: 'PACKAGES' },
];
const STAT_Y = 424;
const statSvg = stats
  .map((s, i) => {
    const x = 72 + i * 158;
    return (
      `<text x="${x}" y="${STAT_Y}" font-family="${SANS}" font-size="34" font-weight="700" fill="${C.text}">${s.v}</text>` +
      `<text x="${x}" y="${STAT_Y + 26}" font-family="${SANS}" font-size="12.5" font-weight="600" letter-spacing="1.6" fill="${C.textMuted}">${s.l}</text>`
    );
  })
  .join('\n    ');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="${C.accent}" stop-opacity="0.34"/>
      <stop offset="55%" stop-color="${C.accent}" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="${C.accent}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#2563eb" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#2563eb" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="fadeLeft" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#000000"/>
      <stop offset="18%" stop-color="#4d4d4d"/>
      <stop offset="42%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.accent}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${C.accent}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="topbar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.fn}"/>
      <stop offset="34%" stop-color="${C.file}"/>
      <stop offset="67%" stop-color="${C.accent}"/>
      <stop offset="100%" stop-color="${C.iface}"/>
    </linearGradient>
    <mask id="graphFade">
      <rect x="640" y="0" width="640" height="${H}" fill="url(#fadeLeft)"/>
    </mask>
    <filter id="soft" x="-70%" y="-70%" width="240%" height="240%">
      <feGaussianBlur stdDeviation="7"/>
    </filter>
    <pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="1" fill="#ffffff" fill-opacity="0.05"/>
    </pattern>
  </defs>

  <!-- background -->
  <rect width="${W}" height="${H}" fill="${C.void}"/>
  <rect width="${W}" height="${H}" fill="url(#dots)"/>
  <ellipse cx="1010" cy="310" rx="470" ry="430" fill="url(#glow)"/>
  <ellipse cx="150" cy="600" rx="420" ry="300" fill="url(#glow2)"/>
  <rect width="${W}" height="4" fill="url(#topbar)"/>

  <!-- knowledge graph -->
  <g mask="url(#graphFade)">
    ${edgeSvg}
    ${flowSvg}
    ${nodeSvg}
    <circle cx="${HUB.x}" cy="${HUB.y}" r="42" fill="none" stroke="${C.accentSoft}" stroke-width="1.2" stroke-opacity="0.35"/>
    <circle cx="${HUB.x}" cy="${HUB.y}" r="72" fill="none" stroke="${C.accentSoft}" stroke-width="1" stroke-opacity="0.16"/>
  </g>

  <!-- lockup -->
  <image xlink:href="data:image/png;base64,${mark}" x="72" y="62" width="58" height="58" opacity="0.97"/>
  <text x="146" y="112" font-family="${SANS}" font-size="54" font-weight="700" letter-spacing="-1.2" fill="${C.text}">CodraGraph</text>

  <!-- eyebrow -->
  <text x="73" y="176" font-family="${MONO}" font-size="14.5" font-weight="600" letter-spacing="3.1" fill="${C.accentSoft}">GRAPH-POWERED CODE INTELLIGENCE FOR AI AGENTS</text>
  <rect x="72" y="196" width="300" height="1.5" fill="url(#rule)"/>

  <!-- headline -->
  <text x="72" y="256" font-family="${SANS}" font-size="31" font-weight="600" fill="${C.text}">Index any codebase into a knowledge graph.</text>
  <text x="72" y="298" font-family="${SANS}" font-size="31" font-weight="600" fill="${C.text}">Query it over <tspan fill="${C.accentSoft}">MCP</tspan>, <tspan fill="${C.accentSoft}">CLI</tspan>, <tspan fill="${C.accentSoft}">SDK</tspan>, or <tspan fill="${C.accentSoft}">HTTP</tspan>.</text>

  <text x="72" y="348" font-family="${SANS}" font-size="19" fill="${C.textSecondary}">Your agent stops grepping and starts querying &#8212; version the graph like git,</text>
  <text x="72" y="374" font-family="${SANS}" font-size="19" fill="${C.textSecondary}">and auto-tune the harness per task family.</text>

  <!-- stats -->
  ${statSvg}

  <!-- command chip -->
  <rect x="72" y="486" width="446" height="54" rx="12" fill="${C.surface}" stroke="${C.border}" stroke-width="1.5"/>
  <text x="96" y="520" font-family="${MONO}" font-size="19" fill="${C.accentSoft}">$</text>
  <text x="120" y="520" font-family="${MONO}" font-size="19" fill="${C.text}">npx @codragraph/cli analyze .</text>

  <!-- footer -->
  <text x="72" y="592" font-family="${SANS}" font-size="14.5" fill="${C.textMuted}">PolyForm Noncommercial 1.0.0  &#183;  Built on GitNexus  &#183;  github.com/AnitChaudhry/CodraGraph</text>
</svg>`;

fs.writeFileSync(path.join(__dirname, 'cover.svg'), svg);

sharp(Buffer.from(svg))
  .png({ compressionLevel: 9, palette: true, quality: 92 })
  .toFile(OUT)
  .then((info) => {
    console.log(`${OUT} ${info.width}x${info.height} ${(info.size / 1024).toFixed(0)} KB`);
  })
  .catch((e) => console.error('ERR', e.message));
