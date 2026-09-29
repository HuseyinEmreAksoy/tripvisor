#!/usr/bin/env node
/**
 * i18n:check — translation gate (ADR-0011 §6, M5 Y1.4).
 *
 *   npm run i18n:check                      # resources + migrated paths
 *   npm run i18n:check -- --strict          # + raw-literal scan of ALL of app/ and src/components/
 *   npm run i18n:check -- --strict app/legal src/components/profile   # strict scan of these paths only
 *
 * Checks (errors fail the run):
 *   1. Every namespace exists in both `en` and `tr` (src/i18n/locales/<lang>/<ns>.json).
 *   2. Key parity: every English key exists in Turkish and vice versa. Plural keys
 *      (`_one` / `_other` …) are compared by base key, and each language must have
 *      the plural forms its `Intl.PluralRules` needs.
 *   3. No empty or non-string values.
 *   4. `{{placeholders}}` and `<tags>` (Trans) match between the two languages.
 *   5. No unused keys: a key counts as used when source code (app/, src/, tests
 *      excluded) mentions it as a string literal — `'key'` in a file that uses the
 *      namespace, or `'ns:key'` anywhere — or a template literal starts with one of
 *      its prefixes (`cards.${key}.title`, `common:relative.${unit}`). An ancestor
 *      path counts too (`returnObjects`). `ns:key` literals that don't exist fail.
 *   6. No raw user-facing literals (JSX text, or label/placeholder/accessibility*
 *      string props) in the MIGRATED paths below. Brand names and single glyphs are
 *      allowed; add `// i18n-ignore` on the line (or the line above) to opt out.
 *
 * Plain CommonJS (no TS runner in the repo) so it runs on Node 20+ and inside Jest
 * (src/i18n/__tests__/i18nCheck.test.ts). Parsing uses the repo's `typescript`.
 */
const fs = require('fs');
const path = require('path');

/**
 * Paths that are fully translated. Every UI step that extracts a file or
 * directory adds it here, so it can never regress to hard-coded English.
 */
const MIGRATED = [
  'app/_layout.tsx',
  'app/index.tsx',
  'app/(auth)',
  'app/(app)/(tabs)/_layout.tsx',
  'app/(app)/(tabs)/settings.tsx',
  'app/legal',
  'src/components/auth',
  'src/components/legal',
  'src/components/navigation/AppTabBar.tsx',
  'src/components/onboarding',
  'src/components/profile',
  'src/components/BackButton.tsx',
  'src/components/GoogleSignInButton.tsx',
  'src/components/HeroValueChips.tsx',
  'src/components/TabBar.tsx',
];

/** Scanned by `--strict` with no path arguments (Y4.3 makes this the default). */
const STRICT_ROOTS = ['app', 'src/components'];

/** Source roots searched for key usage. */
const USAGE_ROOTS = ['app', 'src'];

const LANGS = ['en', 'tr'];
const SOURCE = 'en';
const DEFAULT_NS = 'common';
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const USER_FACING_PROPS = new Set([
  'label',
  'title',
  'placeholder',
  'accessibilityLabel',
  'accessibilityHint',
  'aria-label',
  'alt',
  'subtitle',
  'hint',
  'message',
  'confirmLabel',
  'cancelLabel',
  'emptyText',
  'description',
]);
/** Literals that may appear untranslated (brand, product names). */
const ALLOWED_LITERALS = new Set(['Tripvisor', 'Google', 'Powered by Google']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const stat = fs.statSync(dir);
  if (stat.isFile()) {
    out.push(dir);
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    walk(path.join(dir, entry.name), out);
  }
  return out;
}

const isSource = (file) => /\.(ts|tsx)$/.test(file) && !/\.d\.ts$/.test(file);
const isTest = (file) => /[\\/]__tests__[\\/]|\.test\.(ts|tsx)$/.test(file);
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');

// ─── Resources ────────────────────────────────────────────────────────────────

function flatten(value, prefix, out, errors, where) {
  if (typeof value === 'string') {
    if (value.trim() === '') errors.push(`${where}: empty value at "${prefix}"`);
    out.set(prefix, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(v, prefix ? `${prefix}.${i}` : String(i), out, errors, where));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out, errors, where);
    return;
  }
  errors.push(`${where}: non-string value at "${prefix}" (${JSON.stringify(value)})`);
}

function loadResources(root, errors) {
  const base = path.join(root, 'src/i18n/locales');
  const byLang = {};
  for (const lang of LANGS) {
    byLang[lang] = {};
    const dir = path.join(base, lang);
    if (!fs.existsSync(dir)) {
      errors.push(`missing locale directory src/i18n/locales/${lang}`);
      continue;
    }
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const ns = file.replace(/\.json$/, '');
      const where = `${lang}/${file}`;
      let json;
      try {
        json = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      } catch (e) {
        errors.push(`${where}: invalid JSON (${e.message})`);
        continue;
      }
      const flat = new Map();
      flatten(json, '', flat, errors, where);
      byLang[lang][ns] = flat;
    }
  }
  return byLang;
}

const placeholders = (s) => [...s.matchAll(/\{\{\s*([\w.]+)\s*(?:,[^}]*)?\}\}/g)].map((m) => m[1]).sort().join(',');
const tags = (s) => [...s.matchAll(/<\/?([a-zA-Z][\w-]*)\s*\/?>/g)].map((m) => m[1]).sort().join(',');

function pluralCategories(lang) {
  try {
    return new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
  } catch {
    return ['one', 'other'];
  }
}

/** base key → Set of plural categories present ('' = not plural). */
function groupPlurals(flat) {
  const groups = new Map();
  for (const key of flat.keys()) {
    const m = PLURAL_SUFFIX.exec(key);
    const baseKey = m ? key.slice(0, -m[0].length) : key;
    if (!groups.has(baseKey)) groups.set(baseKey, new Set());
    groups.get(baseKey).add(m ? m[1] : '');
  }
  return groups;
}

function checkParity(byLang, errors) {
  const source = byLang[SOURCE] || {};
  const namespaces = new Set(LANGS.flatMap((l) => Object.keys(byLang[l] || {})));
  for (const ns of namespaces) {
    for (const lang of LANGS) {
      if (!byLang[lang] || !byLang[lang][ns]) errors.push(`namespace "${ns}" missing in ${lang}`);
    }
    const src = source[ns];
    if (!src) continue;
    const srcGroups = groupPlurals(src);
    for (const lang of LANGS) {
      const flat = byLang[lang] && byLang[lang][ns];
      if (!flat) continue;
      const groups = groupPlurals(flat);
      const needed = pluralCategories(lang);
      for (const [baseKey, cats] of groups) {
        const isPlural = !cats.has('') || cats.size > 1;
        if (isPlural) {
          for (const cat of needed) {
            if (!cats.has(cat)) errors.push(`${lang}/${ns}.json: "${baseKey}" is missing plural form _${cat}`);
          }
        }
      }
      if (lang === SOURCE) continue;
      for (const baseKey of srcGroups.keys()) {
        if (!groups.has(baseKey)) errors.push(`${lang}/${ns}.json: missing key "${baseKey}" (present in ${SOURCE})`);
      }
      for (const baseKey of groups.keys()) {
        if (!srcGroups.has(baseKey)) errors.push(`${lang}/${ns}.json: extra key "${baseKey}" (not in ${SOURCE})`);
      }
      for (const [key, value] of flat) {
        const other = src.get(key) ?? src.get(`${key.replace(PLURAL_SUFFIX, '')}_other`);
        if (typeof other !== 'string') continue;
        const pA = placeholders(other).split(',').filter((p) => p !== 'count').join(',');
        const pB = placeholders(value).split(',').filter((p) => p !== 'count').join(',');
        if (pA !== pB) errors.push(`${lang}/${ns}.json: "${key}" placeholders {{${pB}}} differ from ${SOURCE} {{${pA}}}`);
        if (tags(other) !== tags(value)) errors.push(`${lang}/${ns}.json: "${key}" tags <${tags(value)}> differ from ${SOURCE} <${tags(other)}>`);
      }
    }
  }
}

// ─── Source scanning ──────────────────────────────────────────────────────────

function loadTs(root) {
  try {
    return require(require.resolve('typescript', { paths: [root] }));
  } catch {
    throw new Error('i18n:check needs the `typescript` package (a devDependency).');
  }
}

function parse(ts, file) {
  const text = fs.readFileSync(file, 'utf8');
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return { text, sf: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind) };
}

function collectUsage(ts, root, namespaces) {
  const files = USAGE_ROOTS.flatMap((r) => walk(path.join(root, r))).filter(
    (f) => isSource(f) && !isTest(f) && !f.includes(`${path.sep}locales${path.sep}`),
  );
  const qualified = new Set(); // 'ns:key' literals and prefixes from anywhere
  const qualifiedPrefixes = new Set();
  const perNs = new Map(namespaces.map((ns) => [ns, { literals: new Set(), prefixes: new Set() }]));
  for (const file of files) {
    const { sf } = parse(ts, file);
    const literals = new Set();
    const prefixes = new Set();
    const visit = (node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) literals.add(node.text);
      else if (ts.isTemplateExpression(node) && node.head.text) prefixes.add(node.head.text);
      ts.forEachChild(node, visit);
    };
    visit(sf);
    const referenced = new Set([DEFAULT_NS]);
    for (const lit of literals) {
      if (perNs.has(lit)) referenced.add(lit);
      const m = /^([a-z]+):/.exec(lit);
      if (m && perNs.has(m[1])) {
        referenced.add(m[1]);
        qualified.add(lit);
      }
    }
    for (const p of prefixes) {
      const m = /^([a-z]+):/.exec(p);
      if (m && perNs.has(m[1])) qualifiedPrefixes.add(p);
    }
    for (const ns of referenced) {
      const bucket = perNs.get(ns);
      literals.forEach((l) => bucket.literals.add(l));
      prefixes.forEach((p) => bucket.prefixes.add(p));
    }
  }
  return { qualified, qualifiedPrefixes, perNs };
}

function ancestors(key) {
  const parts = key.split('.');
  return parts.map((_, i) => parts.slice(0, i + 1).join('.'));
}

function checkUsage(ts, root, byLang, errors) {
  const source = byLang[SOURCE] || {};
  const namespaces = Object.keys(source);
  const usage = collectUsage(ts, root, namespaces);
  let unused = 0;
  for (const ns of namespaces) {
    const bucket = usage.perNs.get(ns);
    for (const baseKey of groupPlurals(source[ns]).keys()) {
      const chain = ancestors(baseKey);
      const used =
        chain.some((k) => bucket.literals.has(k) || usage.qualified.has(`${ns}:${k}`)) ||
        [...bucket.prefixes].some((p) => baseKey.startsWith(p)) ||
        [...usage.qualifiedPrefixes].some((p) => `${ns}:${baseKey}`.startsWith(p));
      if (!used) {
        unused += 1;
        errors.push(`${SOURCE}/${ns}.json: unused key "${baseKey}"`);
      }
    }
  }
  for (const lit of usage.qualified) {
    const [ns, key] = [lit.slice(0, lit.indexOf(':')), lit.slice(lit.indexOf(':') + 1)];
    if (!/^[\w.]+$/.test(key) || !source[ns]) continue;
    const groups = groupPlurals(source[ns]);
    const exists = groups.has(key) || [...groups.keys()].some((k) => k.startsWith(`${key}.`));
    if (!exists) errors.push(`code references unknown key "${lit}"`);
  }
  return unused;
}

function lineOf(sf, pos) {
  return sf.getLineAndCharacterOfPosition(pos).line;
}

function isIgnored(lines, line) {
  return /i18n-ignore/.test(lines[line] || '') || /i18n-ignore/.test(lines[line - 1] || '');
}

function suspicious(text) {
  const s = text.replace(/\s+/g, ' ').trim();
  if (!s || !/\p{L}/u.test(s)) return null;
  if ([...s].length === 1) return null; // glyphs such as the Google "G"
  if (ALLOWED_LITERALS.has(s)) return null;
  return s;
}

function scanLiterals(ts, root, targets) {
  const files = targets.flatMap((t) => walk(path.join(root, t))).filter((f) => f.endsWith('.tsx') && !isTest(f));
  const findings = [];
  for (const file of files) {
    const { text, sf } = parse(ts, file);
    const lines = text.split(/\r?\n/);
    const report = (node, value, what) => {
      const line = lineOf(sf, node.getStart(sf));
      if (isIgnored(lines, line)) return;
      findings.push(`${rel(root, file)}:${line + 1}: raw ${what} "${value.slice(0, 60)}"`);
    };
    const visit = (node) => {
      if (ts.isJsxText(node)) {
        const s = suspicious(node.text);
        if (s) report(node, s, 'JSX text');
      } else if (ts.isJsxAttribute(node) && node.initializer) {
        const name = node.name.getText(sf);
        if (USER_FACING_PROPS.has(name)) {
          let init = node.initializer;
          if (ts.isJsxExpression(init) && init.expression) init = init.expression;
          if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init) || ts.isTemplateExpression(init)) {
            const s = suspicious(ts.isTemplateExpression(init) ? init.getText(sf).slice(1, -1) : init.text);
            if (s) report(node, s, `${name}=`);
          }
        }
      } else if (ts.isJsxExpression(node) && node.expression && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
        const e = node.expression;
        if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTemplateExpression(e)) {
          const raw = ts.isTemplateExpression(e) ? e.getText(sf).slice(1, -1).replace(/\$\{[^}]*\}/g, ' ') : e.text;
          const s = suspicious(raw);
          if (s) report(node, s, 'JSX string');
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return findings;
}

// ─── Entry points ─────────────────────────────────────────────────────────────

/**
 * @param {{ root?: string, strict?: boolean, paths?: string[] }} [options]
 * @returns {{ errors: string[], stats: { namespaces: number, keys: number, unused: number, scannedPaths: string[] } }}
 */
function runI18nCheck(options = {}) {
  const root = options.root || path.resolve(__dirname, '..');
  const errors = [];
  const byLang = loadResources(root, errors);
  checkParity(byLang, errors);
  const ts = loadTs(root);
  const unused = checkUsage(ts, root, byLang, errors);
  const scannedPaths = options.strict ? (options.paths && options.paths.length ? options.paths : STRICT_ROOTS) : MIGRATED;
  errors.push(...scanLiterals(ts, root, scannedPaths));
  const source = byLang[SOURCE] || {};
  const keys = Object.values(source).reduce((n, flat) => n + groupPlurals(flat).size, 0);
  return { errors, stats: { namespaces: Object.keys(source).length, keys, unused, scannedPaths } };
}

function main(argv) {
  const strict = argv.includes('--strict');
  const paths = argv.filter((a) => !a.startsWith('--'));
  const { errors, stats } = runI18nCheck({ strict, paths });
  const scope = strict ? `strict: ${stats.scannedPaths.join(', ')}` : `${stats.scannedPaths.length} migrated paths`;
  if (errors.length) {
    console.error(`i18n:check failed with ${errors.length} problem(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    console.error(`(${stats.namespaces} namespaces, ${stats.keys} keys; literal scan: ${scope})`);
    process.exitCode = 1;
    return;
  }
  console.log(`i18n:check OK — ${stats.namespaces} namespaces, ${stats.keys} keys, en/tr in parity; literal scan: ${scope}.`);
}

module.exports = { runI18nCheck, MIGRATED, STRICT_ROOTS };

if (require.main === module) main(process.argv.slice(2));
