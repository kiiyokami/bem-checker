const dropZone    = document.getElementById('drop-zone');
const folderInput = document.getElementById('folder-input');
const pickBtn     = document.getElementById('pick-btn');
const statusEl    = document.getElementById('status');
const resultsEl   = document.getElementById('results');
const summaryEl   = document.getElementById('summary');
const fileListEl  = document.getElementById('file-list');

const SKIP_DIRS = new Set(['node_modules', 'vendor']);
const VALID_EXTS = new Set(['css', 'scss', 'sass', 'less', 'html', 'htm']);

const COLOR_PROPS = new Set([
  'color', 'background', 'background-color', 'border-color',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'outline', 'outline-color', 'box-shadow', 'text-shadow',
  'fill', 'stroke', 'caret-color', 'text-decoration-color',
]);

const SPACING_PROPS = new Set([
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'gap', 'row-gap', 'column-gap',
  'font-size', 'line-height',
  'border-radius', 'border-width',
  'max-width', 'min-width', 'max-height', 'min-height',
  'top', 'right', 'bottom', 'left',
]);

pickBtn.addEventListener('click', () => folderInput.click());

folderInput.addEventListener('change', async () => {
  const files = Array.from(folderInput.files).filter(f => {
    const parts = f.webkitRelativePath.split('/');
    if (parts.some(p => SKIP_DIRS.has(p) || p.startsWith('.'))) return false;
    return VALID_EXTS.has(ext(f.name));
  });
  await run(files.map(f => ({ path: f.webkitRelativePath, read: () => f.text() })));
});

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));

dropZone.addEventListener('drop', async e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');

  const entries = [];
  for (const item of e.dataTransfer.items) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  setStatus('Reading files…');
  const files = [];
  for (const entry of entries) await collectEntries(entry, files);
  await run(files);
});

async function collectEntries(entry, out) {
  if (entry.isFile) {
    if (VALID_EXTS.has(ext(entry.name))) {
      out.push({
        path: entry.fullPath.replace(/^\//, ''),
        read: () => readEntry(entry),
      });
    }
  } else if (entry.isDirectory) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) return;
    const children = await readDirEntries(entry.createReader());
    for (const child of children) await collectEntries(child, out);
  }
}

function readDirEntries(reader) {
  return new Promise(resolve => {
    const all = [];
    const read = () => reader.readEntries(batch => {
      if (!batch.length) return resolve(all);
      all.push(...batch);
      read();
    });
    read();
  });
}

function readEntry(fileEntry) {
  return new Promise((resolve, reject) =>
    fileEntry.file(f => f.text().then(resolve, reject), reject)
  );
}

async function run(files) {
  if (!files.length) { setStatus('No matching files found.'); return; }

  setStatus(`Scanning ${files.length} file(s)…`);
  resultsEl.style.display = 'none';
  fileListEl.innerHTML = '';

  // First pass: read all files and extract data
  const fileData = [];
  for (const file of files) {
    const content = await file.read();
    const e = ext(file.path);
    const isCSS = !['html', 'htm'].includes(e);
    fileData.push({
      file,
      isCSS,
      classes: isCSS ? extractCSS(content) : extractHTML(content),
      declarations: isCSS ? extractDeclarations(content) : [],
      idSelectors: isCSS ? extractIDSelectors(content) : [],
      atImports: isCSS ? extractAtImports(content) : [],
    });
  }

  // Build global class name set for cross-file naming convention check
  const allClassNames = new Set(fileData.flatMap(d => d.classes.map(([, cls]) => cls)));

  // Second pass: check violations
  const groups = [];
  let total = 0;

  for (const { file, classes, declarations, idSelectors, atImports } of fileData) {
    const violations = [];

    for (const [line, cls] of classes) {
      for (const msg of checkBEM(cls)) {
        violations.push({ line, label: `.${cls}`, msg, type: 'bem' });
        total++;
      }
      const ncMsg = checkNamingConvention(cls, allClassNames);
      if (ncMsg) {
        violations.push({ line, label: `.${cls}`, msg: ncMsg, type: 'convention' });
        total++;
      }
    }

    for (const [line, prop, value] of declarations) {
      const aMsg = checkA11y(prop, value);
      if (aMsg) { violations.push({ line, label: prop, msg: aMsg, type: 'a11y' }); total++; }
      const sMsg = checkSecurity(prop, value);
      if (sMsg) { violations.push({ line, label: prop, msg: sMsg, type: 'security' }); total++; }
      const hMsg = checkHardcoded(prop, value);
      if (hMsg) { violations.push({ line, label: prop, msg: hMsg, type: 'hardcoded' }); total++; }
      const qMsg = checkQuality(prop, value);
      if (qMsg) { violations.push({ line, label: prop, msg: qMsg, type: 'quality' }); total++; }
    }

    for (const [line, id] of idSelectors) {
      violations.push({ line, label: `#${id}`, msg: 'ID selector — avoid for styling, use a class instead', type: 'quality' });
      total++;
    }

    for (const line of atImports) {
      violations.push({ line, label: '@import', msg: 'avoid @import — it blocks rendering, use <link> tags instead', type: 'quality' });
      total++;
    }

    if (violations.length) groups.push({ path: file.path, violations });
  }

  render(groups, total, files.length);
}

function render(groups, total, fileCount) {
  summaryEl.innerHTML = total === 0
    ? `<span class="summary-ok">✓ No violations</span><span class="summary-info">${fileCount} file(s) scanned</span>`
    : `<span class="summary-fail">${total} violation(s)</span><span class="summary-info">across ${groups.length} file(s) · ${fileCount} scanned</span>`;

  for (const { path, violations } of groups) {
    const div = document.createElement('div');
    div.className = 'file-group';
    div.innerHTML =
      `<button class="file-header" aria-expanded="true">
         <span class="file-path">${esc(path)}</span>
         <span class="file-count">${violations.length} error${violations.length === 1 ? '' : 's'}</span>
         <span class="chevron">▾</span>
       </button>
       <div class="file-body">` +
      violations.map(v =>
        `<div class="violation violation--${v.type}">
           <span class="loc">:${v.line}</span>
           <span class="cls">${esc(v.label)}</span>
           <span class="msg">${esc(v.msg)}</span>
         </div>`
      ).join('') +
      `</div>`;

    div.querySelector('.file-header').addEventListener('click', function () {
      const expanded = this.getAttribute('aria-expanded') === 'true';
      this.setAttribute('aria-expanded', !expanded);
      this.querySelector('.chevron').textContent = expanded ? '▸' : '▾';
      div.querySelector('.file-body').style.display = expanded ? 'none' : 'block';
    });

    fileListEl.appendChild(div);
  }

  resultsEl.style.display = 'block';
  setStatus('');
}

function extractCSS(content) {
  const results = [];
  const lines = content.split('\n');
  let inBlock = false;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let i = 0;
    while (i < line.length) {
      if (inBlock) {
        if (line[i] === '*' && line[i+1] === '/') { inBlock = false; i += 2; }
        else i++;
        continue;
      }
      if (line[i] === '/' && line[i+1] === '*') { inBlock = true; i += 2; continue; }
      if (line[i] === '/' && line[i+1] === '/') break;
      if (line[i] === '.') {
        i++;
        if (i < line.length && line[i] >= '0' && line[i] <= '9') { i++; continue; }
        const start = i;
        while (i < line.length && isClassChar(line[i])) i++;
        if (i > start) results.push([li + 1, line.slice(start, i)]);
      } else {
        i++;
      }
    }
  }
  return results;
}

function extractHTML(content) {
  const results = [];
  const lines = content.split('\n');

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lower = line.toLowerCase();
    let pos = 0;

    while (pos < lower.length) {
      const rel = lower.indexOf('class=', pos);
      if (rel === -1) break;

      const prev = rel > 0 ? lower[rel - 1] : ' ';
      pos = rel + 6;
      if (!' \t<'.includes(prev)) continue;

      while (pos < lower.length && ' \t'.includes(lower[pos])) pos++;
      const q = lower[pos];
      if (q !== '"' && q !== "'") continue;

      const vStart = pos + 1;
      const vEnd = line.indexOf(q, vStart);
      if (vEnd === -1) continue;

      for (const cls of line.slice(vStart, vEnd).split(/\s+/).filter(Boolean)) {
        results.push([li + 1, cls]);
      }
      pos = vEnd + 1;
    }
  }
  return results;
}

function extractDeclarations(content) {
  const results = [];
  const lines = content.split('\n');
  let inComment = false;

  for (let li = 0; li < lines.length; li++) {
    let line = lines[li];

    // Strip block comments
    if (inComment) {
      const end = line.indexOf('*/');
      if (end === -1) continue;
      line = line.slice(end + 2);
      inComment = false;
    }
    const commentStart = line.indexOf('/*');
    if (commentStart !== -1) {
      const commentEnd = line.indexOf('*/', commentStart + 2);
      if (commentEnd === -1) { inComment = true; line = line.slice(0, commentStart); }
      else line = line.slice(0, commentStart) + line.slice(commentEnd + 2);
    }

    // Strip line comments
    const lineComment = line.indexOf('//');
    if (lineComment !== -1) line = line.slice(0, lineComment);

    const match = line.match(/^\s*([\w-]+)\s*:\s*(.+?)\s*;?\s*$/);
    if (match) results.push([li + 1, match[1], match[2].trim()]);
  }
  return results;
}

function isClassChar(c) { return /[a-zA-Z0-9\-_]/.test(c); }

function checkBEM(cls) {
  const v = [];

  if (/[A-Z]/.test(cls)) { v.push('contains uppercase letters'); return v; }
  if (cls.startsWith('__')) { v.push('element without a block (starts with __)'); return v; }
  if (cls.startsWith('--')) { v.push('modifier without a block (starts with --)'); return v; }

  const ep = cls.split('__');
  if (ep.length > 2) { v.push('nested elements not allowed in BEM (more than one __ found)'); return v; }
  if (ep.length === 2 && ep[0].includes('--')) v.push('element after modifier is invalid BEM (block--modifier__element)');

  const e0 = checkSegment(ep[0], 'block');
  if (e0) v.push(e0);

  if (ep[1] !== undefined) {
    if (ep[1] === '') v.push('empty element name after __');
    else { const e1 = checkSegment(ep[1], 'element'); if (e1) v.push(e1); }
  }

  return v;
}

function checkSegment(part, ctx) {
  const mp = part.split('--');
  if (mp.length > 2) return `multiple -- in ${ctx} '${part}' — each block/element can have one modifier`;
  for (let i = 0; i < mp.length; i++) {
    const seg = mp[i];
    if (!seg) return `empty ${i === 0 ? ctx + ' name' : 'modifier value'}`;
    if (!/^[a-z][a-z0-9-]*$/.test(seg))
      return `invalid ${i === 0 ? ctx : 'modifier'} name '${seg}': must be lowercase letters, digits, or hyphens`;
  }
  return null;
}

function checkNamingConvention(cls, allClassNames) {
  if (cls.includes('__') || cls.includes('--')) return null;

  const parts = cls.split('-');
  if (parts.length < 2) return null;

  for (let i = parts.length - 1; i >= 1; i--) {
    const base = parts.slice(0, i).join('-');
    if (allClassNames.has(base)) {
      const suffix = parts.slice(i).join('-');
      return `possible modifier using single hyphen — consider .${base}--${suffix} (modifier) or .${base}__${suffix} (element)`;
    }
  }
  return null;
}

const CSS_KEYWORDS = new Set([
  'none', 'transparent', 'inherit', 'initial', 'unset', 'revert',
  'auto', 'normal', 'currentcolor', '0',
]);

function checkHardcoded(prop, value) {
  if (prop.startsWith('--')) return null;
  if (value.includes('var(')) return null;
  if (CSS_KEYWORDS.has(value.toLowerCase())) return null;
  if (/^0(px|rem|em)$/.test(value)) return null;

  if (COLOR_PROPS.has(prop)) {
    if (/#[0-9a-fA-F]{3,8}/.test(value))     return `hardcoded color value — use a CSS variable`;
    if (/rgba?\s*\(/.test(value))              return `hardcoded color value — use a CSS variable`;
    if (/hsla?\s*\(/.test(value))              return `hardcoded color value — use a CSS variable`;
  }

  if (SPACING_PROPS.has(prop)) {
    if (/\b\d+\.?\d*(px|rem|em)\b/.test(value)) return `hardcoded size value — use a CSS variable`;
  }

  return null;
}

function checkA11y(prop, value) {
  if (prop === 'outline' && /^(none|0)$/.test(value.trim())) return `outline: ${value} removes the focus indicator — keyboard users cannot see what is focused`;
  if (prop === 'user-select' && value.trim() === 'none')     return `user-select: none prevents text selection — avoid on readable content`;
  if (prop === 'pointer-events' && value.trim() === 'none')  return `pointer-events: none blocks all mouse interaction — ensure a keyboard alternative exists`;
  return null;
}

function checkSecurity(prop, value) {
  if (/javascript\s*:/i.test(value))                          return `javascript: URI in CSS value — XSS vector`;
  if (/expression\s*\(/i.test(value))                         return `CSS expression() executes JavaScript — major XSS risk`;
  if (prop === '-moz-binding')                                 return `-moz-binding loads external XBL scripts — code execution risk`;
  if (prop === 'behavior')                                     return `behavior: loads HTC files that execute scripts`;
  if (/url\s*\(\s*['"]?\s*https?:\/\//i.test(value))          return `external URL in url() — risk of data exfiltration or CSP bypass`;
  return null;
}

function checkQuality(prop, value) {
  if (value.includes('!important')) return `avoid !important — it breaks the cascade`;
  if (prop === 'float' && /^(left|right)$/.test(value)) return `avoid float layout — use flexbox or grid`;
  if (prop === 'z-index' && /^\d+$/.test(value) && parseInt(value) > 9) return `magic z-index value — use a CSS variable or a defined scale`;
  if ((prop === 'transition' || prop === 'animation') && /\ball\b/.test(value)) return `transition: all animates every property — list only the properties you need`;
  return null;
}

function extractIDSelectors(content) {
  const results = [];
  const lines = content.split('\n');
  let inComment = false;
  let depth = 0;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let i = 0;
    while (i < line.length) {
      if (inComment) {
        if (line[i] === '*' && line[i+1] === '/') { inComment = false; i += 2; }
        else i++;
        continue;
      }
      if (line[i] === '/' && line[i+1] === '*') { inComment = true; i += 2; continue; }
      if (line[i] === '/' && line[i+1] === '/') break;
      if (line[i] === '{') { depth++; i++; continue; }
      if (line[i] === '}') { depth--; i++; continue; }
      if (depth === 0 && line[i] === '#' && i + 1 < line.length && /[a-zA-Z_]/.test(line[i + 1])) {
        i++;
        const start = i;
        while (i < line.length && isClassChar(line[i])) i++;
        results.push([li + 1, line.slice(start, i)]);
      } else {
        i++;
      }
    }
  }
  return results;
}

function extractAtImports(content) {
  const results = [];
  const lines = content.split('\n');
  for (let li = 0; li < lines.length; li++) {
    if (/^\s*@import\b/.test(lines[li])) results.push(li + 1);
  }
  return results;
}

function ext(name) { return name.split('.').pop().toLowerCase(); }
function setStatus(msg) { statusEl.textContent = msg; }
function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
