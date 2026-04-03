const dropZone    = document.getElementById('drop-zone');
const folderInput = document.getElementById('folder-input');
const pickBtn     = document.getElementById('pick-btn');
const statusEl    = document.getElementById('status');
const resultsEl   = document.getElementById('results');
const summaryEl   = document.getElementById('summary');
const fileListEl  = document.getElementById('file-list');

const SKIP_DIRS = new Set(['node_modules', 'vendor']);
const VALID_EXTS = new Set(['css', 'scss', 'sass', 'less', 'html', 'htm']);

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

  const groups = [];
  let total = 0;

  for (const file of files) {
    const content = await file.read();
    const e = ext(file.path);
    const pairs = e === 'html' || e === 'htm'
      ? extractHTML(content)
      : extractCSS(content);

    const violations = [];
    for (const [line, cls] of pairs) {
      for (const msg of checkBEM(cls)) {
        violations.push({ line, cls, msg });
        total++;
      }
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
    div.innerHTML = `<div class="file-path">${esc(path)}</div>` +
      violations.map(v =>
        `<div class="violation">
           <span class="loc">:${v.line}</span>
           <span class="cls">.${esc(v.cls)}</span>
           <span class="msg">${esc(v.msg)}</span>
         </div>`
      ).join('');
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

function ext(name) { return name.split('.').pop().toLowerCase(); }
function setStatus(msg) { statusEl.textContent = msg; }
function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
