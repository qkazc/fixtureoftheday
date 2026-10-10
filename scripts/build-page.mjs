// Packs the Vite build into one self-contained HTML file (CSS and JS inlined),
// ready to publish as a single page. Run via `npm run build:page`.
// Output: dist/fixture-of-the-day.html
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const assets = 'dist/assets';
const files = readdirSync(assets);
const read = (ext) => {
  const name = files.find((f) => f.endsWith(ext));
  if (!name) throw new Error(`no ${ext} file in ${assets}; run the Vite build first`);
  return readFileSync(join(assets, name), 'utf8');
};

const css = read('.css');
const js = read('.js');
// Inlined code must not close its own <script> tag early.
if (/<\/script/i.test(js)) throw new Error('the bundle contains "</script", which would break inlining');

const html = `<title>Fixture of the Day</title>
<style>${css}</style>
<div id="app"></div>
<script type="module">${js}</script>
`;
const out = 'dist/fixture-of-the-day.html';
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(1)} KB)`);
