// ══════════════════════════════════════════

var _recog      = null;
var _voiceOn    = false;

function initVoice() {
  const SR  = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = document.getElementById('micBtn');
  if (!SR) { btn.classList.add('hidden'); return; }

  _recog = new SR();
  _recog.lang            = 'ja-JP';
  _recog.continuous      = true;
  _recog.interimResults  = true;
  _recog.maxAlternatives = 1;

  _recog.onresult = e => {
    const status = document.getElementById('voiceStatus');
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        const lines = parseVoiceText(t);
        if (lines.length) {
          const ta  = document.getElementById('ingredientInput');
          const cur = ta.value.trim();
          ta.value  = cur ? cur + '\n' + lines.join('\n') : lines.join('\n');
          saveStorage();
        }
        interim = '';
      } else { interim = t; }
    }
    if (interim) {
      status.textContent = '🎤 ' + interim;
      status.classList.add('active');
    } else {
      status.textContent = '聞いています… 例：「鶏もも肉 三百グラム」「砂糖 大さじ二」';
    }
  };

  _recog.onerror = e => {
    if (e.error === 'no-speech') return;
    document.getElementById('voiceStatus').textContent = 'エラー: ' + e.error;
    _stopVoice();
  };

  // Auto-restart (continuous mode can stop unexpectedly)
  _recog.onend = () => { if (_voiceOn) { try { _recog.start(); } catch(_) {} } };
}

function toggleVoice() {
  if (!_recog) return;
  if (_voiceOn) { _voiceOn = false; _recog.stop(); _stopVoice(); }
  else { _voiceOn = true; _recog.start(); _startVoice(); }
}

function _startVoice() {
  const btn = document.getElementById('micBtn');
  const st  = document.getElementById('voiceStatus');
  btn.classList.add('listening');
  btn.title = 'クリックして停止';
  st.textContent = '聞いています… 例：「鶏もも肉 三百グラム」「砂糖 大さじ二」';
  st.classList.add('active');
}
function _stopVoice() {
  _voiceOn = false;
  const btn = document.getElementById('micBtn');
  const st  = document.getElementById('voiceStatus');
  btn.classList.remove('listening');
  btn.title = '音声入力（クリックして開始）';
  st.textContent = '';
  st.classList.remove('active');
}

// ── 音声テキスト → 材料行 ──────────────────

function parseVoiceText(text) {
  // 「と」「、」「，」で複数材料を区切る
  return text.split(/[とと、，,]+/).map(normalizeVoiceLine).filter(Boolean);
}

function normalizeVoiceLine(text) {
  text = text.trim();
  if (!text) return null;

  // 単位の読み仮名 → 表記
  const unitMap = [
    [/キログラム|きろぐらむ|キロ/g, 'kg'],
    [/ミリリットル|みりりっとる/g, 'ml'],
    [/ミリ|みり/g, 'ml'],
    [/リットル|りっとる/g, 'L'],
    [/グラム|ぐらむ/g, 'g'],
    [/おおさじ|大匙/g, '大さじ'],
    [/こさじ|小匙/g, '小さじ'],
    [/かっぷ/g, 'カップ'],
    [/こ$|個$/g, '個'],
    [/ほん$|本$/g, '本'],
    [/まい$|枚$/g, '枚'],
  ];
  for (const [re, rep] of unitMap) text = text.replace(re, rep);

  // 「半分」「半」→ 1/2
  text = text.replace(/半分|はんぶん/g, '1/2');
  text = text.replace(/(大さじ|小さじ|カップ)\s*半(?!\d)/g, '$1 1/2');

  // 漢数字 → アラビア数字
  text = text.replace(/[〇零一二三四五六七八九十百千]+/g, m => {
    const n = jpNumToArabic(m);
    return n !== null ? String(n) : m;
  });

  return text;
}

function jpNumToArabic(s) {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const d = { '〇':0,'零':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };
  let result = 0, cur = 0;
  for (const ch of s) {
    if (d[ch] !== undefined)  { cur = d[ch]; }
    else if (ch === '十') { result += (cur || 1) * 10;   cur = 0; }
    else if (ch === '百') { result += (cur || 1) * 100;  cur = 0; }
    else if (ch === '千') { result += (cur || 1) * 1000; cur = 0; }
  }
  result += cur;
  return result || null;
}

// ══════════════════════════════════════════
// CLEAR
// ══════════════════════════════════════════

function clearAll() {
  document.getElementById('ingredientInput').value = '';
  document.getElementById('fromPerson').value = '2';
  document.getElementById('toPerson').value   = '4';
  document.getElementById('resultCard').style.display = 'none';
  document.getElementById('emptyState').style.display = 'block';
  document.getElementById('saveBtn').style.display = 'none';
  _nutrTotal = null; _nutrPer = null;
  _lastResults = [];
  _bakerData = [];
  _costResults = [];
  document.getElementById('dietBar').style.display = 'none';
  document.getElementById('bakerCard').style.display = 'none';
  document.getElementById('bakerFlourG').value = '';
  document.getElementById('costSection').style.display = 'none';
  sessionStorage.removeItem('sc_input');
  ['sc_from','sc_to'].forEach(k => localStorage.removeItem(k));
}

// ══════════════════════════════════════════
// INDEXEDDB
// ══════════════════════════════════════════

var DB_NAME  = 'ScalerDB';
var DB_VER   = 1;
var DB_STORE = 'recipes';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath:'id', autoIncrement:true });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbSaveRecipe(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(DB_STORE, 'readwrite');
    const req = tx.objectStore(DB_STORE).add({
      name,
      ingredients: document.getElementById('ingredientInput').value,
      fromPerson:  document.getElementById('fromPerson').value,
      toPerson:    document.getElementById('toPerson').value,
      savedAt:     new Date().toISOString(),
    });
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function dbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ══════════════════════════════════════════
// SAVED RECIPES UI
// ══════════════════════════════════════════

var _savedOpen = false;

function toggleSavedPanel() {
  _savedOpen = !_savedOpen;
  const body    = document.getElementById('savedBody');
  const chevron = document.getElementById('savedChevron');
  if (_savedOpen) {
    body.classList.remove('closed');
    body.style.maxHeight = body.scrollHeight + 'px';
    chevron.classList.add('open');
    renderRecipeList(); // refresh on open
  } else {
    body.style.maxHeight = '0';
    body.classList.add('closed');
    chevron.classList.remove('open');
  }
}

async function renderRecipeList() {
  const list  = document.getElementById('recipeList');
  const count = document.getElementById('recipeCount');
  let recipes = [];
  try { recipes = await dbGetAll(); } catch(e) { /* IndexedDB unavailable */ }

  count.textContent = recipes.length;
  if (recipes.length === 0) {
    list.innerHTML = '<div class="empty-recipes">保存されたレシピはありません</div>';
    return;
  }

  // Sort newest first
  recipes.sort((a,b) => new Date(b.savedAt) - new Date(a.savedAt));

  list.innerHTML = recipes.map(r => `
    <div class="recipe-item">
      <span class="recipe-item-name" title="${escHtml(r.name)}">${escHtml(r.name)}</span>
      <span class="badge">${r.fromPerson}→${r.toPerson}人前</span>
      <span class="recipe-item-meta">${fmtDate(r.savedAt)}</span>
      <div class="recipe-item-actions">
        <button class="btn btn-ghost" onclick="loadRecipe(${r.id})">読込</button>
        <button class="btn btn-danger" onclick="deleteRecipe(${r.id})">削除</button>
      </div>
    </div>`).join('');
}

async function loadRecipe(id) {
  const db = await openDB();
  const recipe = await new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE,'readonly').objectStore(DB_STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
  if (!recipe) return;
  document.getElementById('ingredientInput').value = recipe.ingredients;
  document.getElementById('fromPerson').value = recipe.fromPerson;
  document.getElementById('toPerson').value   = recipe.toPerson;
  convert();
  window.scrollTo({ top: 0, behavior:'smooth' });
}

async function deleteRecipe(id) {
  await dbDelete(id);
  await renderRecipeList();
  // Update max-height after content changes
  if (_savedOpen) {
    const body = document.getElementById('savedBody');
    body.style.maxHeight = body.scrollHeight + 'px';
  }
}

// ══════════════════════════════════════════
// SAVE MODAL
// ══════════════════════════════════════════

function openSaveModal() {
  document.getElementById('recipeNameInput').value = '';
  document.getElementById('saveModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('recipeNameInput').focus(), 50);
}

function closeSaveModal() {
  document.getElementById('saveModal').classList.add('hidden');
}

function onModalOverlayClick(e) {
  if (e.target === document.getElementById('saveModal')) closeSaveModal();
}

async function confirmSave() {
  const name = document.getElementById('recipeNameInput').value.trim();
  if (!name) { document.getElementById('recipeNameInput').focus(); return; }
  await dbSaveRecipe(name);
  closeSaveModal();
  await renderRecipeList();
  // Auto-open saved panel to show result
  if (!_savedOpen) toggleSavedPanel();
  else if (_savedOpen) {
    const body = document.getElementById('savedBody');
    body.style.maxHeight = body.scrollHeight + 'px';
  }
}

document.getElementById('recipeNameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') confirmSave();
  if (e.key === 'Escape') closeSaveModal();
});

// ══════════════════════════════════════════
// QR CODE  (pure JS, no library)
// ══════════════════════════════════════════
// Minimal QR encoder: Version 1-10, ECC Level M, Byte mode (UTF-8)
// Based on the open QR spec. Generates a pixel matrix then draws to Canvas.

var QR = (() => {
  // ── Reed-Solomon GF(256) ──────────────────
  const GF = (() => {
    const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x = x << 1; if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
    const mul = (a, b) => a && b ? EXP[LOG[a] + LOG[b]] : 0;
    const poly = (n) => { // generator poly for n EC bytes
      let p = [1];
      for (let i = 0; i < n; i++) {
        const q = [1, EXP[i]];
        const r = new Uint8Array(p.length + 1);
        for (let j = 0; j < p.length; j++)
          for (let k = 0; k < q.length; k++)
            r[j + k] ^= mul(p[j], q[k]);
        p = Array.from(r);
      }
      return p;
    };
    const ec = (data, nec) => {
      const gen = poly(nec);
      const msg = [...data, ...new Array(nec).fill(0)];
      for (let i = 0; i < data.length; i++) {
        const c = msg[i];
        if (!c) continue;
        for (let j = 0; j < gen.length; j++) msg[i + j] ^= mul(c, gen[j]);
      }
      return msg.slice(data.length);
    };
    return { ec };
  })();

  // ── QR version/capacity table (Byte mode, ECC M) ──
  // [version, capacity bytes, ec codewords, blocks, data codewords per block]
  const VER = [
    null,
    [1,16,10,1,16],  [2,28,16,1,28],  [3,44,26,1,44],
    [4,64,36,2,32],  [5,86,48,2,43],  [6,108,64,2,54],
    [7,124,72,4,31], [8,154,88,4,38], [9,182,110,4,46],
    [10,216,130,4,54]
  ];

  // ── Alignment pattern positions ──
  const ALIGN = [null,[],[],[],[],[],[],[6,22],[6,24],[6,26],[6,28]];

  // ── Format info (ECC M, mask pattern 2: (r+c)%3==0) ──
  // Precomputed for all 8 masks, ECC M = 0b00
  const FMT_ECCM = [
    0x5412,0x5125,0x5E7C,0x5B4B,0x45F9,0x40CE,0x4F97,0x4AA0
  ];

  function encode(text) {
    const utf8 = unescape(encodeURIComponent(text));
    const bytes = Array.from(utf8).map(c => c.charCodeAt(0));
    const len   = bytes.length;

    // Find smallest version that fits
    let ver = 1;
    while (ver <= 10 && VER[ver][1] < len) ver++;
    if (ver > 10) return null; // too long

    const [v, cap, ecTotal, blocks] = VER[ver];
    const totalCW  = cap + ecTotal;
    const ecPerBlk = Math.floor(ecTotal / blocks);
    const dataCW   = cap;
    const dataPerBlk = Math.floor(dataCW / blocks);

    // ── Build data bits ──────────────────────
    let bits = '';
    const b = n => { bits += n; };
    b('0100'); // Byte mode
    b(len.toString(2).padStart(ver < 10 ? 8 : 16, '0'));
    for (const byte of bytes) b(byte.toString(2).padStart(8,'0'));
    // Terminator
    const maxBits = dataCW * 8;
    const term = Math.min(4, maxBits - bits.length);
    bits += '0'.repeat(term);
    // Byte-align
    while (bits.length % 8) bits += '0';
    // Pad bytes
    let pi = 0;
    while (bits.length < maxBits) { bits += ['11101100','00010001'][pi++ % 2]; }

    // ── Data codewords → blocks → EC ────────
    const data = [];
    for (let i = 0; i < bits.length; i += 8)
      data.push(parseInt(bits.slice(i, i+8), 2));

    const blkData = [], blkEC = [];
    let pos = 0;
    for (let bl = 0; bl < blocks; bl++) {
      const sz = dataPerBlk + (bl >= blocks - (dataCW % blocks || 0) ? 0 : 0);
      const d  = data.slice(pos, pos + dataPerBlk); pos += dataPerBlk;
      blkData.push(d);
      blkEC.push(GF.ec(d, ecPerBlk));
    }

    // Interleave data
    const final = [];
    for (let i = 0; i < dataPerBlk; i++) for (const b of blkData) if (i < b.length) final.push(b[i]);
    for (let i = 0; i < ecPerBlk;   i++) for (const b of blkEC)   final.push(b[i]);

    // ── Build matrix ─────────────────────────
    const size = ver * 4 + 17;
    const M    = () => Array.from({length:size}, () => new Array(size).fill(null));
    const mat  = M();
    const func = M(); // functional modules (not masked)

    const set = (r, c, v, f=true) => { mat[r][c] = v; if(f) func[r][c] = 1; };

    // Finder patterns
    const finder = (tr, tc) => {
      for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
        const rr = tr+r, cc = tc+c;
        if (rr<0||rr>=size||cc<0||cc>=size) continue;
        const inPat = r>=0&&r<=6&&c>=0&&c<=6;
        const onBorder = r===0||r===6||c===0||c===6;
        const inInner = r>=2&&r<=4&&c>=2&&c<=4;
        set(rr, cc, inPat ? (onBorder||inInner ? 1 : 0) : 0);
      }
    };
    finder(0,0); finder(0,size-7); finder(size-7,0);

    // Timing
    for (let i = 8; i < size-8; i++) { set(6,i,(i%2===0)?1:0); set(i,6,(i%2===0)?1:0); }

    // Dark module
    set(size-8, 8, 1);

    // Alignment patterns
    const ap = ALIGN[ver];
    if (ap.length) {
      for (const r of ap) for (const c of ap) {
        if (func[r][c]) continue;
        for (let dr=-2;dr<=2;dr++) for (let dc=-2;dc<=2;dc++) {
          const v = (dr===-2||dr===2||dc===-2||dc===2) ? 1 : (dr===0&&dc===0) ? 1 : 0;
          set(r+dr, c+dc, v);
        }
      }
    }

    // Reserve format areas
    for (let i=0;i<9;i++) { set(8,i,0); set(i,8,0); }
    for (let i=size-8;i<size;i++) { set(8,i,0); set(i,8,0); }
    set(8,8,0);

    // ── Place data bits (mask 2: (r+c)%3==0) ─
    const MASK = (r,c) => (r+c)%3===0;
    let bi = 0;
    const finalBits = final.flatMap(b => Array.from({length:8},(_,i)=>(b>>(7-i))&1));
    // Zigzag column pairs, right to left
    for (let col = size-1; col > 0; col -= 2) {
      if (col === 6) col--; // skip timing
      for (let row = 0; row < size; row++) {
        const r = ((Math.floor((size-1-col)/2)) % 2 === 0) ? size-1-row : row;
        for (let dc = 0; dc < 2; dc++) {
          const c = col - dc;
          if (func[r][c] !== null) continue;
          const bit = bi < finalBits.length ? finalBits[bi++] : 0;
          mat[r][c] = bit ^ (MASK(r,c) ? 1 : 0);
          func[r][c] = 0;
        }
      }
    }

    // ── Format info (mask 2, ECC M) ──────────
    const fmt = FMT_ECCM[2];
    const fmtBits = Array.from({length:15},(_,i)=>(fmt>>(14-i))&1);
    const fpos = [0,1,2,3,4,5,7,8,size-7,size-6,size-5,size-4,size-3,size-2,size-1];
    for (let i=0;i<15;i++) {
      mat[8][fpos[i]] = fmtBits[i];
      mat[fpos[i]][8] = fmtBits[i];
    }

    return { mat, size };
  }

  function draw(canvas, text, opts = {}) {
    const { scale = 5, margin = 4, dark = '#0f0f0f', light = '#ffffff' } = opts;
    const qr = encode(text);
    if (!qr) { console.warn('QR: text too long'); return false; }
    const { mat, size } = qr;
    const px = (size + margin * 2) * scale;
    canvas.width  = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = light; ctx.fillRect(0,0,px,px);
    ctx.fillStyle = dark;
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++)
        if (mat[r][c]) ctx.fillRect((c+margin)*scale, (r+margin)*scale, scale, scale);
    return true;
  }

  return { draw };
})();

// ── QR UI ─────────────────────────────────

function openQrModal() {
  const ing  = document.getElementById('ingredientInput').value.trim();
  const from = document.getElementById('fromPerson').value;
  const to   = document.getElementById('toPerson').value;
  if (!ing) return;

  // Encode recipe as URL fragment (no server needed)
  const payload = JSON.stringify({ ing, from, to });
  const encoded = btoa(unescape(encodeURIComponent(payload)));
  const url     = `${location.origin}${location.pathname}#r=${encoded}`;

  const canvas = document.getElementById('qrCanvas');
  const ok = QR.draw(canvas, url, { scale:5, margin:4, dark:'#111', light:'#fff' });

  document.getElementById('qrUrl').textContent = url.length > 80 ? url.slice(0,77)+'…' : url;
  document.getElementById('qrModal').classList.remove('hidden');

  if (!ok) {
    document.getElementById('qrUrl').textContent = '材料が多すぎてQRに収まりません。材料を減らしてください。';
  }
}

function closeQrModal() { document.getElementById('qrModal').classList.add('hidden'); }
function onQrOverlayClick(e) { if (e.target === document.getElementById('qrModal')) closeQrModal(); }

function downloadQr() {
  const canvas = document.getElementById('qrCanvas');
  const a = document.createElement('a');
  a.download = 'recipe-qr.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
}

// ── Load from URL fragment ─────────────────
function loadFromHash() {
  try {
    const m = location.hash.match(/[#&]r=([^&]+)/);
    if (!m) return;
    const data = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    if (data.ing) document.getElementById('ingredientInput').value = data.ing;
    if (data.from) document.getElementById('fromPerson').value = data.from;
    if (data.to)   document.getElementById('toPerson').value   = data.to;
    history.replaceState(null,'', location.pathname);
    convert();
  } catch(_) {}
}

// ══════════════════════════════════════════
// LOCALSTORAGE (auto-save input)
// ══════════════════════════════════════════

function saveStorage() {
  // 入力テキストはsessionStorage（タブを閉じると自動クリア）
  sessionStorage.setItem('sc_input', document.getElementById('ingredientInput').value);
  // 人数設定はlocalStorage（次回も引き継ぐ）
  localStorage.setItem('sc_from', document.getElementById('fromPerson').value);
  localStorage.setItem('sc_to',   document.getElementById('toPerson').value);
}

function loadStorage() {
  const inp  = sessionStorage.getItem('sc_input');
  const from = localStorage.getItem('sc_from');
  const to   = localStorage.getItem('sc_to');
  if (from) document.getElementById('fromPerson').value = from;
  if (to)   document.getElementById('toPerson').value   = to;
  if (inp)  { document.getElementById('ingredientInput').value = inp; convert(); }
}

['ingredientInput','fromPerson','toPerson'].forEach(id => {
  document.getElementById(id).addEventListener('input', saveStorage);
});
['fromPerson','toPerson'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => { if (e.key==='Enter') convert(); });
});

// ══════════════════════════════════════════
// INIT
// ══════════════════════════════════════════

renderRecipeList();
loadFromHash();
if (!location.hash) loadStorage();
initVoice();

// ══════════════════════════════════════════
// BACKUP / RESTORE
// ══════════════════════════════════════════

async function exportRecipes(e) {
  e.stopPropagation(); // prevent panel toggle
  let recipes = [];
  try { recipes = await dbGetAll(); } catch(_) {}
  if (recipes.length === 0) { alert('保存済みレシピがありません。'); return; }

  const data = { version: 1, exportedAt: new Date().toISOString(), recipes };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `scaler-recipes-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importRecipes(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = ''; // reset input

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch(_) {
    alert('JSONの読み込みに失敗しました。ファイルを確認してください。'); return;
  }

  const recipes = data.recipes || (Array.isArray(data) ? data : null);
  if (!recipes || !Array.isArray(recipes)) {
    alert('形式が正しくありません。'); return;
  }

  const db  = await openDB();
  let count = 0;
  for (const r of recipes) {
    if (!r.name || !r.ingredients) continue;
    await new Promise((resolve, reject) => {
      // Strip existing id so autoIncrement assigns a new one
      const { id: _omit, ...record } = r;
      const req = db.transaction(DB_STORE,'readwrite').objectStore(DB_STORE).add(record);
      req.onsuccess = resolve; req.onerror = resolve; // ignore duplicates
    });
    count++;
  }

  await renderRecipeList();
  if (_savedOpen) {
    const body = document.getElementById('savedBody');
    body.style.maxHeight = body.scrollHeight + 'px';
  }
  alert(`${count} 件のレシピを読み込みました。`);
}

// ══════════════════════════════════════════
// DIET PROFILES
// ══════════════════════════════════════════

// Keywords that VIOLATE each profile (partial match)
var dietViolations = {
  gf: ['小麦','薄力粉','強力粉','中力粉','小麦粉','パスタ','うどん','そうめん','ひやむぎ','スパゲティ','ラーメン','中華麺','パン粉','天ぷら粉','お好み焼き粉','ホットケーキ粉','餃子の皮','ワンタンの皮','醤油','みりん','味噌','麦茶','麦'],
  vegan: ['鶏','豚','牛','羊','ラム','鴨','豚バラ','鶏もも','鶏むね','ひき肉','挽き肉','合挽き','レバー','ベーコン','ソーセージ','ハム','サーモン','マグロ','タラ','鮭','エビ','イカ','タコ','アサリ','シジミ','ホタテ','カツオ','魚','卵','たまご','牛乳','ミルク','バター','生クリーム','チーズ','ヨーグルト','はちみつ','蜂蜜','ゼラチン','ラード','ベーコン','アンチョビ','明太子','かつお節','煮干し','だし'],
  lowc: ['砂糖','上白糖','グラニュー糖','ざらめ','はちみつ','蜂蜜','みりん','米','ご飯','パスタ','うどん','そば','パン','小麦粉','片栗粉','コーンスターチ','じゃがいも','さつまいも','かぼちゃ','とうもろこし','バナナ','ぶどう','砂糖菓子','ケチャップ','ソース','みりん風'],
  lowsalt: ['塩','醤油','味噌','みそ','ソース','ケチャップ','マヨネーズ','ポン酢','めんつゆ','だしの素','コンソメ','ブイヨン','オイスターソース','豆板醤','コチュジャン','ナンプラー','アンチョビ','梅干し','塩昆布','ちくわ','かまぼこ','ハム','ベーコン','ソーセージ'],
};

// Keywords that are SAFE / compliant
var dietSafe = {
  gf: ['米','米粉','片栗粉','コーンスターチ','じゃがいも','さつまいも','そば粉','タピオカ'],
  vegan: ['豆腐','納豆','厚揚げ','油揚げ','高野豆腐','きぬ豆腐','豆乳','大豆','枝豆','えだまめ','テンペ'],
  lowc: ['きのこ','ブロッコリー','ほうれん草','小松菜','キャベツ','レタス','トマト','きゅうり','ナス','ピーマン','鶏むね','ささみ','豆腐','納豆'],
  lowsalt: ['レモン','ゆず','ライム','酢','にんにく','しょうが','ごま','ハーブ','スパイス','こしょう','唐辛子','わさび'],
};

var _activeDiets = new Set();
var _lastResults = [];

function setChickenSkin(pref) {
  _chickenSkinPref = pref;
  convert();
}

function toggleDiet(key) {
  if (_activeDiets.has(key)) {
    _activeDiets.delete(key);
  } else {
    _activeDiets.add(key);
  }
  document.getElementById(`chip-${key}`).classList.toggle('active', _activeDiets.has(key));
  applyDietHighlight();
}

function checkIngDiet(name, key) {
  const violations = dietViolations[key] || [];
  for (const kw of violations) {
    if (name.includes(kw) || kw.includes(name.length > 1 ? name : '\x00')) return 'ng';
  }
  return null;
}

function applyDietHighlight() {
  const tbody = document.getElementById('resultBody');
  if (!tbody || !_lastResults.length) return;

  const rows = tbody.querySelectorAll('tr');
  rows.forEach((tr, idx) => {
    const ing = _lastResults[idx];
    if (!ing) return;

    // Remove old flags
    tr.querySelectorAll('.diet-flag').forEach(el => el.remove());
    tr.classList.remove('diet-ng');

    if (_activeDiets.size === 0) return;

    const nameCell = tr.querySelector('.ing-name');
    if (!nameCell) return;

    let anyNg = false;
    for (const key of _activeDiets) {
      const violations = dietViolations[key] || [];
      let matched = false;
      for (const kw of violations) {
        if (ing.name.includes(kw) || (kw.length > 1 && kw.includes(ing.name))) {
          matched = true; break;
        }
      }
      if (matched) {
        const label = { gf:'GF-NG', vegan:'VG-NG', lowc:'糖-NG', lowsalt:'塩-NG' }[key];
        const flag = document.createElement('span');
        flag.className = 'diet-flag diet-flag-ng';
        flag.textContent = label;
        nameCell.appendChild(flag);
        anyNg = true;
      }
    }
    if (anyNg) tr.classList.add('diet-ng');
  });
}

// ══════════════════════════════════════════
// BAKER'S PERCENTAGE
// ══════════════════════════════════════════

// Flour/starch keywords that count as the "base" (100%)
var flourKeywords = ['小麦粉','薄力粉','強力粉','中力粉','全粒粉','ライ麦粉','米粉','そば粉','コーンミール','アーモンドプードル','片栗粉','コーンスターチ','タピオカ粉'];

var _appMode = 'normal';  // 'normal' | 'baker'
var _bakerData = [];      // { name, grams, pct, isBase }

function setMode(mode) {
  _appMode = mode;
  document.getElementById('modeNormal').classList.toggle('active', mode === 'normal');
  document.getElementById('modeBaker').classList.toggle('active', mode === 'baker');

  // Update placeholder
  const ta = document.getElementById('ingredientInput');
  if (mode === 'baker') {
    ta.placeholder = '強力粉：300g\n砂糖：18g\n塩：6g\nドライイースト：3g\nバター：30g\n水：210ml';
  } else {
    ta.placeholder = '砂糖 大さじ2\n醤油 大さじ3\nみりん 大さじ2\n鶏もも肉 300g\n玉ねぎ 1個\n卵 2個\n牛乳 カップ1/2\n塩 少々\nバター 10g';
  }

  // Toggle visible cards
  const normalControls = document.getElementById('normalModeControls');
  const bakerCard = document.getElementById('bakerCard');
  const resultCard = document.getElementById('resultCard');

  if (mode === 'baker') {
    if (normalControls) normalControls.style.display = 'none';
    // Re-run if we already have input
    if (document.getElementById('ingredientInput').value.trim()) runBaker();
  } else {
    if (normalControls) normalControls.style.display = '';
    bakerCard.style.display = 'none';
  }
}

function isFlour(name) {
  return flourKeywords.some(k => name.includes(k) || k.includes(name));
}

function runBaker() {
  const raw = document.getElementById('ingredientInput').value.trim();
  if (!raw) return;

  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const items = [];

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed || !parsed.numStr) continue;
    const num = parseFloat(parsed.numStr);
    if (isNaN(num)) continue;
    const grams = unitToGrams(num, parsed.unit, parsed.name);
    if (grams === null || grams <= 0) continue;
    items.push({ name: parsed.name, grams, isBase: isFlour(parsed.name) });
  }

  if (items.length < 2) {
    document.getElementById('bakerCard').style.display = 'none';
    return;
  }

  // Sum base
  const baseGrams = items.filter(x => x.isBase).reduce((s, x) => s + x.grams, 0);
  if (baseGrams <= 0) {
    document.getElementById('bakerBadge').textContent = '粉類が見つかりません';
    document.getElementById('bakerCard').style.display = 'block';
    document.getElementById('bakerBody').innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:20px;">強力粉・薄力粉など粉類の材料が必要です</td></tr>`;
    return;
  }

  _bakerData = items.map(x => ({ ...x, pct: Math.round((x.grams / baseGrams) * 1000) / 10 }));

  document.getElementById('bakerBadge').textContent = `粉 ${Math.round(baseGrams)}g = 100%`;
  document.getElementById('bakerCard').style.display = 'block';
  document.getElementById('emptyState').style.display = 'none';

  // Pre-fill flour input with detected base
  const flourInput = document.getElementById('bakerFlourG');
  if (!flourInput.value) flourInput.value = Math.round(baseGrams);

  renderBakerTable();
}

function renderBakerTable() {
  const tbody = document.getElementById('bakerBody');
  const maxPct = Math.max(..._bakerData.map(x => x.pct));

  tbody.innerHTML = _bakerData.map((item, i) => {
    const barWidth = Math.min(100, (item.pct / maxPct) * 100);
    return `<tr class="${item.isBase ? 'bp-base-row' : ''}">
      <td><span style="font-weight:500">${escHtml(item.name)}</span>${item.isBase ? '<span class="diet-flag" style="background:rgba(255,179,71,0.15);color:#ffb347;border:1px solid rgba(255,179,71,0.3);margin-left:6px;">BASE</span>' : ''}</td>
      <td><span class="bp-pct">${item.pct}%</span></td>
      <td>
        <div class="bp-bar-track">
          <div class="bp-bar-fill" style="width:${barWidth.toFixed(1)}%;background:${item.isBase ? '#ffb347' : 'var(--accent)'}"></div>
        </div>
      </td>
      <td id="bp-calc-${i}" style="font-family:'DM Mono',monospace;font-size:13px;color:var(--text2);">—</td>
    </tr>`;
  }).join('');

  updateBakerTable();
}

function updateBakerTable() {
  const flourG = parseFloat(document.getElementById('bakerFlourG').value);
  const totalRow = document.getElementById('bakerTotalRow');

  if (!flourG || flourG <= 0) {
    _bakerData.forEach(item => {
      const cell = document.getElementById(`bp-calc-${item.name}`);
      if (cell) cell.textContent = '—';
    });
    totalRow.style.display = 'none';
    return;
  }

  let total = 0;
  _bakerData.forEach((item, i) => {
    const g = Math.round((item.pct / 100) * flourG * 10) / 10;
    total += g;
    const cell = document.getElementById(`bp-calc-${i}`);
    if (cell) cell.innerHTML = `${g}<span style="font-size:10px;color:var(--text3)"> g</span>`;
  });

  totalRow.style.display = 'flex';
  document.getElementById('bakerTotalG').innerHTML = `${Math.round(total)}<span style="font-size:11px;color:var(--text3)"> g</span>`;
}

// ══════════════════════════════════════════
// COST CALCULATION
// ══════════════════════════════════════════

// costPrices[name] = { price: number (円), qty: number (g/ml/個) }
// loaded from localStorage
var _costPrices = {};
var _costResults = [];  // { name, grams } — filled on convert
var _costOpen = false;

(function loadCostPrices() {
  try { _costPrices = JSON.parse(localStorage.getItem('costPrices_v1') || '{}'); } catch(_) {}
})();

function saveCostPrices() {
  try { localStorage.setItem('costPrices_v1', JSON.stringify(_costPrices)); } catch(_) {}
}

function toggleCostBody() {
  _costOpen = !_costOpen;
  document.getElementById('costBody').style.display = _costOpen ? 'block' : 'none';
  document.getElementById('costChevron').textContent = _costOpen ? '▲' : '▼';
}

function initCostSection(results, toPerson) {
  _costResults = results.map(r => ({ name: r.name, grams: r.grams }));
  const section = document.getElementById('costSection');
  if (!_costResults.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  renderCostGrid(toPerson);
}

function renderCostGrid(toPerson) {
  const grid = document.getElementById('costGrid');
  grid.innerHTML = '';

  _costResults.forEach((item, i) => {
    const saved = _costPrices[item.name] || { price: '', qty: '' };
    const row = document.createElement('div');
    row.className = 'cost-row';

    const nameCell = document.createElement('div');
    nameCell.className = 'cost-ing-name';
    nameCell.textContent = item.name;

    const priceCell = document.createElement('div');
    priceCell.innerHTML = `
      <div class="cost-price-wrap">
        <input type="number" min="0" step="1" placeholder="価格" value="${escHtml(String(saved.price))}"
          id="cp-price-${i}" oninput="onCostInput(${i})" style="text-align:right;">
        <span>円 /</span>
        <input type="number" min="1" step="1" placeholder="量" value="${escHtml(String(saved.qty))}"
          id="cp-qty-${i}" oninput="onCostInput(${i})" style="text-align:right;">
        <span>${item.grams !== null ? 'g' : '個'}</span>
      </div>`;

    const calcCell = document.createElement('div');
    calcCell.className = 'cost-calc';
    calcCell.id = `cp-calc-${i}`;
    calcCell.textContent = '—';

    row.append(nameCell, priceCell, calcCell);
    grid.appendChild(row);
  });

  recalcCost(toPerson);
}

function onCostInput(i) {
  const item = _costResults[i];
  const price = parseFloat(document.getElementById(`cp-price-${i}`).value) || 0;
  const qty   = parseFloat(document.getElementById(`cp-qty-${i}`).value)   || 0;
  if (price > 0 && qty > 0) {
    _costPrices[item.name] = { price, qty };
  } else {
    delete _costPrices[item.name];
  }
  saveCostPrices();
  recalcCost(_lastToPerson);
}

var _lastToPerson = 1;

function recalcCost(toPerson) {
  _lastToPerson = toPerson || 1;
  let total = 0, hasAny = false;

  _costResults.forEach((item, i) => {
    const calcCell = document.getElementById(`cp-calc-${i}`);
    if (!calcCell) return;
    const saved = _costPrices[item.name];
    if (!saved || !saved.price || !saved.qty || !item.grams) {
      calcCell.textContent = '—';
      return;
    }
    const cost = (item.grams / saved.qty) * saved.price;
    calcCell.innerHTML = `${Math.round(cost)}<span style="font-size:10px;color:var(--text3)"> 円</span>`;
    total += cost;
    hasAny = true;
  });

  const totalRow = document.getElementById('costTotalRow');
  if (hasAny) {
    totalRow.style.display = 'flex';
    document.getElementById('costTotalVal').innerHTML = `${Math.round(total)}<span style="font-size:12px;color:var(--text3)"> 円</span>`;
    document.getElementById('costTotalPer').textContent = toPerson > 1 ? `（1人前 約${Math.round(total / toPerson)}円）` : '';
  } else {
    totalRow.style.display = 'none';
  }
}

// ══════════════════════════════════════════
// TIMER
// ══════════════════════════════════════════

var timers = [];   // { id, name, total, remaining, state:'idle'|'running'|'paused'|'done', intervalId }
var _timerOpen = false;
var _timerNotifGranted = false;

function toggleTimerPanel() {
  _timerOpen = !_timerOpen;
  const body = document.getElementById('timerBody');
  const chevron = document.getElementById('timerChevron');
  if (_timerOpen) {
    body.classList.remove('closed');
    body.style.maxHeight = body.scrollHeight + 2000 + 'px';
    chevron.textContent = '▲';
    // Request notification permission on first open
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(p => { _timerNotifGranted = p === 'granted'; });
    } else {
      _timerNotifGranted = Notification.permission === 'granted';
    }
  } else {
    body.classList.add('closed');
    body.style.maxHeight = '0';
    chevron.textContent = '▼';
  }
}

function addTimer() {
  const nameEl = document.getElementById('timerName');
  const minEl  = document.getElementById('timerMin');
  const secEl  = document.getElementById('timerSec');
  const min = parseInt(minEl.value) || 0;
  const sec = parseInt(secEl.value) || 0;
  const total = min * 60 + sec;
  if (total <= 0) { minEl.focus(); return; }

  const id = Date.now();
  const name = nameEl.value.trim() || `タイマー${timers.length + 1}`;
  timers.push({ id, name, total, remaining: total, state: 'idle', intervalId: null });

  nameEl.value = '';
  minEl.value  = '';
  secEl.value  = '';

  renderTimers();
  // Expand panel height after adding
  const body = document.getElementById('timerBody');
  body.style.maxHeight = body.scrollHeight + 500 + 'px';
}

function startTimer(id) {
  const t = timers.find(x => x.id === id);
  if (!t || t.state === 'running') return;
  if (t.state === 'done') {
    t.remaining = t.total;
  }
  t.state = 'running';
  t.intervalId = setInterval(() => {
    t.remaining--;
    if (t.remaining <= 0) {
      t.remaining = 0;
      t.state = 'done';
      clearInterval(t.intervalId);
      t.intervalId = null;
      onTimerDone(t);
    }
    updateTimerItem(t);
  }, 1000);
  updateTimerItem(t);
}

function pauseTimer(id) {
  const t = timers.find(x => x.id === id);
  if (!t || t.state !== 'running') return;
  clearInterval(t.intervalId);
  t.intervalId = null;
  t.state = 'paused';
  updateTimerItem(t);
}

function resetTimer(id) {
  const t = timers.find(x => x.id === id);
  if (!t) return;
  clearInterval(t.intervalId);
  t.intervalId = null;
  t.remaining = t.total;
  t.state = 'idle';
  updateTimerItem(t);
}

function deleteTimer(id) {
  const idx = timers.findIndex(x => x.id === id);
  if (idx === -1) return;
  clearInterval(timers[idx].intervalId);
  timers.splice(idx, 1);
  renderTimers();
}

function onTimerDone(t) {
  updateTimerItem(t);
  // Web Notification
  if (_timerNotifGranted) {
    new Notification('タイマー完了', { body: `「${t.name}」が完了しました！`, icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text y="52" font-size="56">⏱</text></svg>' });
  }
  // Fallback: title flash
  let blink = 0;
  const origTitle = document.title;
  const iv = setInterval(() => {
    document.title = blink++ % 2 === 0 ? `⏱ ${t.name} 完了！` : origTitle;
    if (blink > 10) { clearInterval(iv); document.title = origTitle; }
  }, 600);
}

function fmtTimer(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function buildRingSVG(remaining, total, state) {
  const r = 14, cx = 18, cy = 18;
  const circumference = 2 * Math.PI * r;
  const progress = total > 0 ? remaining / total : 1;
  const dash = circumference * progress;
  const color = state === 'done' ? '#ff7b7b' : state === 'running' ? '#e8ff3c' : '#444';
  return `<svg class="timer-ring" viewBox="0 0 36 36">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#2a2a2a" stroke-width="4"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="4"
      stroke-dasharray="${dash.toFixed(2)} ${circumference.toFixed(2)}"
      stroke-dashoffset="${(circumference * 0.25).toFixed(2)}"
      stroke-linecap="round"
      transform="rotate(-90 ${cx} ${cy})"/>
  </svg>`;
}

function buildTimerItemHTML(t) {
  const stateClass = t.state === 'running' ? 'running' : t.state === 'done' ? 'done' : 'idle';
  const canStart  = t.state !== 'running';
  const canPause  = t.state === 'running';
  const startIcon = t.state === 'done' ? '↺' : '▶';
  return `<div class="timer-item" id="ti-${t.id}">
    ${buildRingSVG(t.remaining, t.total, t.state)}
    <span class="timer-name" title="${t.name}">${t.name}</span>
    <span class="timer-display ${stateClass}">${fmtTimer(t.remaining)}</span>
    <div class="timer-btns">
      ${canStart  ? `<button class="btn btn-ghost" style="padding:5px 10px;font-size:13px;" onclick="startTimer(${t.id})">${startIcon}</button>` : ''}
      ${canPause  ? `<button class="btn btn-ghost" style="padding:5px 10px;font-size:13px;" onclick="pauseTimer(${t.id})">⏸</button>` : ''}
      <button class="btn btn-ghost" style="padding:5px 10px;font-size:13px;" onclick="resetTimer(${t.id})">■</button>
      <button class="btn btn-ghost" style="padding:5px 10px;font-size:13px;color:var(--text3);" onclick="deleteTimer(${t.id})">✕</button>
    </div>
  </div>`;
}

function renderTimers() {
  const list  = document.getElementById('timerList');
  const empty = document.getElementById('timerEmpty');
  document.getElementById('timerCount').textContent = timers.length;
  if (timers.length === 0) {
    list.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = timers.map(buildTimerItemHTML).join('');
}

function updateTimerItem(t) {
  const el = document.getElementById(`ti-${t.id}`);
  if (!el) return;
  el.outerHTML = buildTimerItemHTML(t);
}

// Timer: Enter key in inputs
document.getElementById('timerSec').addEventListener('keydown', e => { if (e.key === 'Enter') addTimer(); });
document.getElementById('timerMin').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('timerSec').focus(); });

// ── Service Worker ─────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}