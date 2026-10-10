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

// A complete document, so the file works as a website's home page too (see
// .github/workflows/pages.yml). The description and og: tags give the link
// a preview card when it's pasted into a chat.
const description =
  'A daily puzzle: you are a dry bulk shipbroker with eight hours to match ships to cargoes and fix the deals.';
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Fixture of the Day</title>
<meta name="description" content="${description}">
<meta property="og:title" content="Fixture of the Day">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<link rel="icon" href="data:,">
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script type="module">${js}</script>
</body>
</html>
`;
const out = 'dist/fixture-of-the-day.html';
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(1)} KB)`);
