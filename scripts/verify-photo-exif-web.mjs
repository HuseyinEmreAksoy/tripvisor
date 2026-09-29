/**
 * verify-photo-exif-web.mjs — M5 Y2.1 real-browser proof of the privacy
 * promise ("EXIF/GPS never leave the device") for the WEB photo path.
 *
 * Jest can only fake <canvas>; this script runs the REAL production modules
 * (src/lib/photos/encode.web.ts, exif.ts, pipeline.ts — transpiled with the
 * repo's Babel, loaded into a blank page) inside Playwright's Chromium and
 * feeds them the GPS-tagged fixture:
 *   1. raw canvas output (before our strip step) carries NO EXIF/GPS/XMP/COM
 *      — canvas re-encoding alone already drops the metadata;
 *   2. preparePhoto() output passes the upload gate, is <= 350 KB / 60 KB,
 *      and keeps the capture date (taken_at) read from the ORIGINAL;
 *   3. EXIF orientation is baked into the pixels (an Orientation=6 64x32
 *      image decodes as 32x64) even though the tag itself is dropped.
 *
 * Run: node scripts/verify-photo-exif-web.mjs   (needs `npx playwright install chromium` once)
 * Exit code 1 on any failed assertion. Native (expo-image-manipulator) is
 * verified on device — see the Y2.1 hand-off "what to try".
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PHOTOS = path.join(ROOT, 'src', 'lib', 'photos');

/** Transpile the photo modules to CommonJS factories for a tiny in-page loader. */
function bundle() {
  const babel = require('@babel/core');
  const files = ['encode.web.ts', 'encode.types.ts', 'exif.ts', 'pipeline.ts', 'base64.ts'];
  const factories = files.map((f) => {
    const src = fs.readFileSync(path.join(PHOTOS, f), 'utf8');
    const { code } = babel.transformSync(src, {
      filename: f,
      babelrc: false,
      configFile: false,
      presets: [[require.resolve('@babel/preset-typescript'), { onlyRemoveTypeImports: false }]],
      plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
    });
    const id = './' + f.replace(/\.ts$/, '');
    return `${JSON.stringify(id)}: function (require, module, exports) {\n${code}\n}`;
  });
  return `
(function () {
  var defs = {${factories.join(',\n')}};
  var cache = {};
  function req(id) {
    if (id === './encode') id = './encode.web';
    if (cache[id]) return cache[id].exports;
    if (!defs[id]) throw new Error('module not bundled: ' + id);
    var module = { exports: {} };
    cache[id] = module;
    defs[id](req, module, module.exports);
    return module.exports;
  }
  window.__photos = {
    encodeWeb: req('./encode.web'),
    exif: req('./exif'),
    pipeline: req('./pipeline'),
  };
})();`;
}

const results = [];
function check(desc, pass, detail = '') {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'} ${desc}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ content: bundle() });
    const fixtures = path.join(PHOTOS, '__tests__', 'fixtures');
    const gpsB64 = fs.readFileSync(path.join(fixtures, 'gps-exif.jpg')).toString('base64');
    const orientB64 = fs.readFileSync(path.join(fixtures, 'orientation-6.jpg')).toString('base64');

    const out = await page.evaluate(
      async ({ gpsB64, orientB64 }) => {
        const toBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const { encodeWeb, exif, pipeline } = window.__photos;
        const original = toBytes(gpsB64);
        const file = new Blob([original], { type: 'image/jpeg' });
        const before = exif.inspectJpeg(original);

        // 1. raw canvas output, BEFORE our strip step
        const decoded = await encodeWeb.decodePhoto({ uri: 'blob:fixture', file, mimeType: 'image/jpeg' });
        const raw = await decoded.encodeJpeg(1600, 0.75);
        const rawReport = exif.inspectJpeg(raw.bytes);
        decoded.release();

        // 2. the full pipeline (what the upload queue persists + uploads)
        const prepared = await pipeline.preparePhoto({ uri: 'blob:fixture', file, mimeType: 'image/jpeg' }, encodeWeb.decodePhoto);
        const fullReport = exif.inspectJpeg(prepared.full.bytes);
        const thumbReport = exif.inspectJpeg(prepared.thumb.bytes);
        let gateOk = true;
        try {
          exif.assertNoLocationMetadata(prepared.full.bytes);
          exif.assertNoLocationMetadata(prepared.thumb.bytes);
        } catch {
          gateOk = false;
        }
        const txt = (b) => Array.from(b, (c) => String.fromCharCode(c)).join('');

        // 3. orientation baked into pixels
        const o = await encodeWeb.decodePhoto({ uri: 'blob:o', file: new Blob([toBytes(orientB64)], { type: 'image/jpeg' }) });
        const oEnc = await o.encodeJpeg(1600, 0.8);
        o.release();

        return {
          before,
          rawReport,
          rawBytes: raw.bytes.length,
          fullReport,
          thumbReport,
          gateOk,
          fullBytes: prepared.full.bytes.length,
          thumbBytes: prepared.thumb.bytes.length,
          fullDims: [prepared.full.width, prepared.full.height],
          takenAt: prepared.takenAt,
          leaks: ['Exif', 'GPSLatitude', 'Hagia Sophia', 'TripvisorTestCam'].filter((n) => txt(prepared.full.bytes).includes(n)),
          orientDims: [o.width, o.height],
          orientEncoded: [oEnc.width, oEnc.height],
          orientReport: exif.inspectJpeg(oEnc.bytes),
          ua: navigator.userAgent,
        };
      },
      { gpsB64, orientB64 },
    );

    console.log(`browser: ${out.ua}`);
    check('fixture carries EXIF + GPS before processing', out.before.hasExif && out.before.hasGps);
    check(
      'raw canvas JPEG (before stripping) has no EXIF / GPS / XMP / comment',
      !out.rawReport.hasExif && !out.rawReport.hasGps && !out.rawReport.hasXmp && !out.rawReport.hasComment,
      `markers=${JSON.stringify(out.rawReport.metadataMarkers)} bytes=${out.rawBytes}`,
    );
    check(
      'pipeline output passes the upload gate (full + thumb)',
      out.gateOk && !out.fullReport.hasExif && !out.thumbReport.hasExif && out.leaks.length === 0,
      `leaks=${JSON.stringify(out.leaks)}`,
    );
    check('full <= 350 KB and thumb <= 60 KB', out.fullBytes <= 350 * 1024 && out.thumbBytes <= 60 * 1024, `full=${out.fullBytes} thumb=${out.thumbBytes} dims=${out.fullDims}`);
    check('taken_at read from the ORIGINAL EXIF date', out.takenAt === '2026-07-14T12:30:00.000Z', `takenAt=${out.takenAt}`);
    check(
      'EXIF orientation is applied to the pixels (64x32 + Orientation=6 → 32x64), tag dropped',
      out.orientDims[0] === 32 && out.orientDims[1] === 64 && !out.orientReport.hasExif,
      `decoded=${out.orientDims} encoded=${out.orientEncoded}`,
    );
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => !r).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
