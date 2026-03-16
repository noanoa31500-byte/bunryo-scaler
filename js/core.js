// ══════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════

// 最大公約数（整数のみ）
function _gcd(a, b) { a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b)); return b === 0 ? a : _gcd(b, a % b); }

// 小数→分数文字列（分母2〜16の範囲で近似、例: 0.333→"1/3", 0.4→"2/5"）
// 整数に近い値（frac≈1 などの浮動小数点誤差）は null を返す
function _toFracStr(n) {
  if (n <= 0 || n >= 1) return null; // 整数・0・1以上は分数にしない
  for (let d = 2; d <= 16; d++) {
    const num = Math.round(n * d);
    if (num <= 0 || num >= d) continue; // 0/d や d/d（=整数）は除外
    if (Math.abs(num / d - n) < 0.001) {
      const g = _gcd(num, d);
      return `${num/g}/${d/g}`;
    }
  }
  return null;
}

function fmtN(n) {
  if (!isFinite(n) || isNaN(n)) return '0';
  // 浮動小数点誤差を丸める（例: 0.9999999→1, 1.0000001→1）
  const rounded = Math.round(n * 10000) / 10000;
  if (rounded === 0) return '0';
  if (Number.isInteger(rounded)) return String(rounded);
  const whole = Math.floor(rounded);
  const frac  = rounded - whole;
  const fracStr = _toFracStr(frac > 0 ? frac : rounded);
  if (whole > 0 && fracStr) return `${whole}と${fracStr}`;
  if (whole === 0 && fracStr) return fracStr;
  return parseFloat(rounded.toFixed(2)).toString();
}

function parseFrac(s) {
  s = s.trim();
  if (s.includes('/')) { const [a,b] = s.split('/'); return parseFloat(a)/parseFloat(b); }
  return parseFloat(s) || 0;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

// ══════════════════════════════════════════
// PARSING
// ══════════════════════════════════════════

function parseLine(line) {
  line = line.trim();
  if (!line) return null;

  // 全角→半角正規化
  line = line.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 0x30));
  line = line.replace(/[Ａ-Ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFF21 + 0x41));
  line = line.replace(/[ａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFF41 + 0x61));
  line = line.replace(/／/g, '/');
  line = line.replace(/　/g, ' ');

  // 単位の表記揺れ正規化（ひらがな・カタカナ・英語略称）
  line = line.replace(/おおさじ|大匙|大スプーン|テーブルスプーン|てーぶるすぷーん|tbsp\.?|Tbsp\.?|T\b/g, '大さじ');
  line = line.replace(/こさじ|小匙|小スプーン|ティースプーン|てぃーすぷーん|ちゃさじ|茶さじ|茶匙|tsp\.?|ts\b/g, '小さじ');
  line = line.replace(/カップ|かっぷ|コップ|cup/gi, 'カップ');

  // 漢数字・分量表現の正規化
  line = line.replace(/一/g,'1').replace(/二/g,'2').replace(/三/g,'3')
             .replace(/四/g,'4').replace(/五/g,'5').replace(/六/g,'6')
             .replace(/七/g,'7').replace(/八/g,'8').replace(/九/g,'9');
  // 大さじ/小さじに続く「半」→ 0.5（例: 大さじ半, 小さじ半）
  line = line.replace(/(大さじ|小さじ|カップ)\s*半/gu, '$10.5');
  // 数字の後の「半」→ 0.5（例: 1と半, 2と半）
  line = line.replace(/(\d)\s*と\s*半(?!\d)/gu, '$1と0.5');

  // 「大さじ1杯」→「大さじ1」（数字の有無に関わらず杯を除去）
  line = line.replace(/(大さじ|小さじ)\s*([\d./]*)\s*杯/gu, (_, u, n) => u + n);

  // 帯分数: 大さじ1と1/2 → 大さじ1.5（「と小さじ」形式はreCombが処理）
  line = line.replace(/(大さじ|小さじ|カップ)\s*(\d+(?:\.\d+)?)\s*と\s*([\d./]+)/gu,
    (_, u, whole, frac) => `${u}${parseFloat(whole) + parseFrac(frac)}`);

  // 組み合わせ単位: 大さじ1と小さじ1/2 / 小さじ1と大さじ1 など
  const reComb = /(大さじ|小さじ)\s*([\d./]+)\s*(?:と|＋|\+)?\s*(大さじ|小さじ)\s*([\d./]+)\s*$/u;
  const mComb = line.match(reComb);
  if (mComb) {
    const nameEnd = mComb.index;
    const combName = line.slice(0, nameEnd).replace(/[\s：:]+$/, '').trim();
    if (combName) {
      return {
        name: combName, numStr: null, unit: 'combined',
        combined: [
          { num: parseFrac(mComb[2]), unit: mComb[1] },
          { num: parseFrac(mComb[4]), unit: mComb[3] },
        ],
        suffix: '', isAmbiguous: false, ambiguousNote: null,
      };
    }
  }

  // 曖昧分量（少々・適量など）は先に処理
  const ambigMap = { '少々':'約0.5g','ひとつまみ':'約1g','適量':'（目安：少々〜小さじ1）','少量':'約1〜2g' };
  for (const [w, note] of Object.entries(ambigMap)) {
    const idx = line.lastIndexOf(w);
    if (idx > 0) {
      return { name: line.slice(0, idx).replace(/[\s：:]+$/, '').trim() || line, numStr:null, unit:w, suffix:'', isAmbiguous:true, ambiguousNote:note };
    }
  }

  // 山盛り
  const mYama = line.match(/(.*?)\s*山盛り\s*([\d./]*)?\s*(大さじ|小さじ|g)?$/u);
  if (mYama && mYama[1]) {
    const name = mYama[1].replace(/[\s：:]+$/, '').trim();
    if (name) return { name, numStr: mYama[2]||null, unit: mYama[3]||'山盛り', suffix:'', isAmbiguous:false, ambiguousNote:'通常の約1.5倍', isMountain:true };
  }

  // ── 末尾から数量を抽出（セパレータ完全不要）────────────────
  // 単位先パターン: 大さじ2, 小さじ1/2, カップ1/2
  const reUF = /(大さじ|小さじ|カップ)\s*([\d./]+)\s*$/u;
  // 数字先パターン: 300g, 2個, 10ml, 1/2カップ
  const reNF = /([\d./]+)\s*(大さじ|小さじ|カップ|kg|ml|L|g|個|本|枚|かけ|片|合|升|斗|勺|玉|丁|束|把|房|切れ|粒|節|匹|尾|腹|羽|頭|掴み|袋|缶|棒)\s*$/u;

  const mUF = line.match(reUF);
  const mNF = line.match(reNF);

  // どちらにもマッチする場合、より後ろから始まるほうを採用
  let chosen = null;
  if (mUF && mNF) {
    chosen = mUF.index >= mNF.index ? { type:'uf', m:mUF } : { type:'nf', m:mNF };
  } else if (mUF) {
    chosen = { type:'uf', m:mUF };
  } else if (mNF) {
    chosen = { type:'nf', m:mNF };
  }

  if (chosen) {
    const name = line.slice(0, chosen.m.index).replace(/[\s：:]+$/, '').trim();
    if (!name) return null;
    if (chosen.type === 'uf') {
      return { name, numStr: chosen.m[2], unit: chosen.m[1], suffix:'', isAmbiguous:false, ambiguousNote:null };
    } else {
      return { name, numStr: chosen.m[1], unit: chosen.m[2], suffix:'', isAmbiguous:false, ambiguousNote:null };
    }
  }

  // 数量なし（材料名のみ）
  return { name: line.replace(/[\s：:]+$/, '').trim(), numStr:null, unit:'', suffix:'', isAmbiguous:false, ambiguousNote:null };
}

// ══════════════════════════════════════════
// UNIT → GRAMS
// ══════════════════════════════════════════

var FAT_KEYS = ['サラダ油','ごま油','オリーブオイル','バター','マーガリン','油'];
var POWDER_KEYS = ['砂糖','塩','小麦粉','片栗粉','米粉','コーンスターチ','ベーキングパウダー','きな粉','抹茶','パン粉'];

function isType(name, keys) { return keys.some(k => name.includes(k)); }

function unitToGrams(num, unit, name) {
  const fat = isType(name, FAT_KEYS), powder = isType(name, POWDER_KEYS);
  switch(unit) {
    case '大さじ': return fat ? num*12 : powder ? num*9  : num*15;
    case '小さじ': return fat ? num*4  : powder ? num*3  : num*5;
    case 'カップ': return num*200;
    case 'g':  return num;
    case 'kg': return num*1000;
    case 'ml': return num;
    case 'L':  return num*1000;
    case '個':
      if (name.includes('卵'))      return num*60;
      if (name.includes('玉ねぎ'))  return num*200;
      if (name.includes('じゃがいも')) return num*150;
      if (name.includes('にんじん')) return num*150;
      if (name.includes('トマト'))  return num*150;
      return num*100;
    case '枚': return name.includes('キャベツ') ? num*50 : num*30;
    case '本':
      if (name.includes('ねぎ')) return num*100;
      if (name.includes('にんじん')) return num*150;
      return num*100;
    case 'かけ': case '片': return name.includes('しょうが') ? num*10 : num*5;
    // ── 日本固有の単位 ──────────────────────────────────
    case '合':
      // 米・麦などは体積→重量変換 (1合=150g), 液体は180ml
      if (name.includes('米') || name.includes('麦') || name.includes('もち')) return num*150;
      return num*180;
    case '升': return num*1800;
    case '斗': return num*18000;
    case '勺': return num*18;
    case '玉':
      if (name.includes('キャベツ'))                          return num*1000;
      if (name.includes('白菜'))                              return num*1500;
      if (name.includes('たまねぎ') || name.includes('玉ねぎ') || name.includes('オニオン')) return num*200;
      if (name.includes('にんにく') || name.includes('ガーリック')) return num*50;
      if (name.includes('レタス'))                            return num*300;
      return num*200;
    case '丁':
      if (name.includes('豆腐') || name.includes('とうふ'))  return num*300;
      if (name.includes('こんにゃく'))                        return num*250;
      return num*300;
    case '束': case '把':
      if (name.includes('ほうれん') || name.includes('小松菜') || name.includes('水菜') || name.includes('三つ葉')) return num*200;
      if (name.includes('そば') || name.includes('蕎麦'))    return num*100;
      if (name.includes('うどん'))                            return num*200;
      if (name.includes('春菊'))                              return num*150;
      if (name.includes('にら') || name.includes('ニラ'))    return num*100;
      if (name.includes('パスタ') || name.includes('スパゲッティ')) return num*100;
      return num*150;
    case '房':
      if (name.includes('ブロッコリー'))                      return num*100;
      if (name.includes('ぶどう') || name.includes('葡萄') || name.includes('グレープ')) return num*300;
      if (name.includes('バナナ'))                            return num*80;
      if (name.includes('エリンギ') || name.includes('しめじ') || name.includes('まいたけ')) return num*100;
      return num*100;
    case '切れ':
      if (name.includes('鮭') || name.includes('さけ') || name.includes('サーモン')) return num*80;
      if (name.includes('鱈') || name.includes('たら'))      return num*80;
      if (name.includes('ぶり') || name.includes('鰤'))      return num*80;
      if (name.includes('パン') || name.includes('食パン'))  return num*60;
      return num*80;
    case '粒':
      if (name.includes('コーン') || name.includes('とうもろこし')) return num*0.3;
      if (name.includes('ぶどう') || name.includes('チェリー') || name.includes('さくらんぼ')) return num*8;
      if (name.includes('大豆') || name.includes('枝豆') || name.includes('そら豆')) return num*1;
      return num*5;
    case '節':
      if (name.includes('かつお') || name.includes('鰹') || name.includes('削り')) return num*3;
      if (name.includes('昆布') || name.includes('コンブ'))  return num*10;
      if (name.includes('ごぼう') || name.includes('牛蒡'))  return num*150;
      return num*10;
    case '匹': case '尾':
      if (name.includes('あじ') || name.includes('鰺') || name.includes('いわし') || name.includes('鰯')) return num*100;
      if (name.includes('さんま') || name.includes('秋刀魚')) return num*150;
      if (name.includes('いか') || name.includes('烏賊'))    return num*200;
      if (name.includes('えび') || name.includes('海老') || name.includes('エビ')) return num*20;
      if (name.includes('あゆ') || name.includes('鮎'))      return num*60;
      return num*100;
    case '腹':
      // 魚の腹子（卵巣）: たらこ/いくら/すじこ等
      if (name.includes('たらこ') || name.includes('明太'))   return num*60;
      if (name.includes('いくら') || name.includes('すじこ')) return num*50;
      if (name.includes('かずのこ') || name.includes('数の子')) return num*30;
      return num*50;
    case '羽':
      if (name.includes('鶏') || name.includes('チキン') || name.includes('にわとり')) return num*500;
      return num*500;
    case '頭':
      // 大型動物（牛・豚・羊など）は料理レシピでは稀だが念のため
      if (name.includes('牛') || name.includes('うし'))       return num*400000;
      if (name.includes('豚') || name.includes('ぶた'))       return num*100000;
      if (name.includes('羊') || name.includes('ひつじ'))     return num*30000;
      return num*100000;
    case '掴み':
      if (name.includes('そば') || name.includes('うどん') || name.includes('パスタ')) return num*80;
      if (name.includes('わかめ') || name.includes('海藻') || name.includes('昆布'))  return num*5;
      if (name.includes('塩') || name.includes('砂糖') || name.includes('粉'))        return num*3;
      return num*15;
    case '袋':
      if (name.includes('もやし'))                            return num*200;
      if (name.includes('ほうれん') || name.includes('小松菜')) return num*200;
      if (name.includes('豆腐') || name.includes('とうふ'))  return num*300;
      if (name.includes('ミックスベジタブル'))                return num*200;
      return num*200;
    case '缶':
      if (name.includes('トマト') || name.includes('ホールトマト')) return num*400;
      if (name.includes('ツナ') || name.includes('シーチキン') || name.includes('まぐろ')) return num*70;
      if (name.includes('サバ') || name.includes('鯖'))      return num*190;
      if (name.includes('イワシ') || name.includes('いわし') || name.includes('鰯')) return num*150;
      if (name.includes('さんま') || name.includes('サンマ') || name.includes('秋刀魚')) return num*150;
      if (name.includes('鮭') || name.includes('サーモン') || name.includes('さけ')) return num*180;
      if (name.includes('コーン') || name.includes('とうもろこし')) return num*200;
      if (name.includes('たけのこ') || name.includes('タケノコ')) return num*500;
      if (name.includes('グリンピース'))                      return num*432;
      if (name.includes('マッシュルーム'))                    return num*400;
      if (name.includes('小豆') || name.includes('あずき'))  return num*430;
      if (name.includes('大豆') || name.includes('豆'))      return num*200;
      return num*200;
    case '棒':
      if (name.includes('ちくわ'))                            return num*30;
      if (name.includes('かにかま') || name.includes('カニカマ')) return num*12;
      if (name.includes('バター'))                            return num*200;
      if (name.includes('きゅうり') || name.includes('胡瓜')) return num*100;
      return num*50;
    default: return null;
  }
}

// ══════════════════════════════════════════
// NUTRITION CALCULATION
// ══════════════════════════════════════════

function getNutrKey(name) {
  if (nutritionDB[name]) return name;
  for (const k of Object.keys(nutritionDB)) {
    if (name.includes(k)) return k;
  }
  return null;
}

function calcNutrition(grams, name) {
  if (grams === null) return null;
  // 表記揺れ正規化（漢字・カタカナ変換）
  const normName = applyFoodAliases(name);
  // built-in DBを元の名前・正規化後の両方で検索
  const key = getNutrKey(name) || (normName !== name ? getNutrKey(normName) : null);
  if (key) {
    const d = nutritionDB[key];
    return {
      kcal: d.kcal*grams/100,
      p:    d.p*grams/100,
      f:    d.f*grams/100,
      c:    d.c*grams/100,
      s:    (d.s||0)*grams/100,
    };
  }
  // フォールバック: 食品成分表DB（文部科学省2020年版）
  const fd = findInFoodDB(normName);
  if (fd) {
    return {
      kcal: fd.kcal*grams/100,
      p:    fd.p*grams/100,
      f:    fd.f*grams/100,
      c:    fd.c*grams/100,
      s:    fd.s*grams/100,
    };
  }
  return null;
}

// ══════════════════════════════════════════
// SCALE INGREDIENT
// ══════════════════════════════════════════

function scaleIngredient(parsed, ratio) {
  const { name, numStr, unit, suffix, isAmbiguous, ambiguousNote, isMountain } = parsed;

  // 組み合わせ単位（大さじN+小さじM）
  if (unit === 'combined' && parsed.combined) {
    const parts = parsed.combined
      .map(p => ({ num: p.num * ratio, unit: p.unit }))
      .filter(p => p.num > 0);
    const display = parts.map(p => {
      if (p.unit === '大さじ') return `大さじ ${fmtN(p.num)}`;
      if (p.unit === '小さじ') return `小さじ ${fmtN(p.num)}`;
      return `${fmtN(p.num)}${p.unit}`;
    }).join('と');
    const grams = parts.reduce((sum, p) => {
      const g = unitToGrams(p.num, p.unit, name);
      return g !== null ? sum + g : sum;
    }, 0);
    return { display, note: null, grams: grams > 0 ? grams : null };
  }

  if (isAmbiguous) return { display:unit, note:ambiguousNote, grams:null };
  if (isMountain) {
    if (numStr) { const sc = parseFrac(numStr)*ratio; return { display:`山盛り ${fmtN(sc)}${unit!=='山盛り'?unit:''}`, note:'通常の約1.5倍', grams:null }; }
    return { display:'山盛り', note:'通常の約1.5倍', grams:null };
  }
  if (numStr === null) return { display:unit||'—', note:null, grams:null };

  const orig = parseFrac(numStr), scaled = orig * ratio;
  let display = '', note = null;

  if (unit === '大さじ') {
    display = `大さじ ${fmtN(scaled)}`;
    if (scaled < 1 && scaled > 0) note = `（小さじ${fmtN(scaled*3)}）`;
  } else if (unit === '小さじ') {
    display = `小さじ ${fmtN(scaled)}`;
    if (scaled >= 3) note = `（大さじ${fmtN(scaled/3)}）`;
  } else if (unit === 'カップ') {
    display = `カップ ${fmtN(scaled)}`;
  } else if (unit) {
    display = `${fmtN(scaled)}${unit}`;
  } else {
    display = fmtN(scaled);
  }
  if (suffix) display += ` ${suffix}`;

  return { display, note, grams: unitToGrams(scaled, unit, name) };
}

// ══════════════════════════════════════════
// STATE
// ══════════════════════════════════════════

var _nutrTotal = null;   // { kcal, p, f, c } total
var _nutrPer   = null;   // per person
var _nutrView  = 'total';

// ══════════════════════════════════════════
// MAIN CONVERT
// ══════════════════════════════════════════

function convert() {
  const raw  = document.getElementById('ingredientInput').value.trim();
  const from = parseFloat(document.getElementById('fromPerson').value) || 1;
  const to   = parseFloat(document.getElementById('toPerson').value)   || 1;
  const ratio = to / from;
  if (!raw) return;

  const results = [];
  let totalKcal=0, totalP=0, totalF=0, totalC=0, totalSodium=0;
  let hasNutr=false, hasSodium=false;

  for (const line of raw.split('\n')) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const scaled = scaleIngredient(parsed, ratio);
    const nutr   = calcNutrition(scaled.grams, parsed.name);
    const allergens = getIngredientAllergens(parsed.name);
    if (nutr) {
      totalKcal+=nutr.kcal; totalP+=nutr.p; totalF+=nutr.f; totalC+=nutr.c;
      totalSodium+=nutr.s; hasNutr=true;
      if (nutr.s > 0) hasSodium = true;
    }
    results.push({ name:parsed.name, display:scaled.display, note:scaled.note, ambiguousNote:parsed.ambiguousNote, nutr, allergens, grams:scaled.grams });
  }

  _nutrTotal = hasNutr ? { kcal:totalKcal, p:totalP, f:totalF, c:totalC } : null;
  _nutrPer   = hasNutr ? { kcal:totalKcal/to, p:totalP/to, f:totalF/to, c:totalC/to } : null;
  const sodiumData = hasSodium ? { total: totalSodium, per: totalSodium/to } : null;
  _nutrView  = 'total';

  renderResult(results, ratio, from, to, sodiumData);
  saveStorage();
}

// ══════════════════════════════════════════
// RENDER RESULT
// ══════════════════════════════════════════

function getSubstitute(name) {
  if (substitutes[name]) return substitutes[name];
  for (const k of Object.keys(substitutes)) {
    if (name.includes(k)||k.includes(name)) return substitutes[k];
  }
  return null;
}

function renderResult(results, ratio, from, to, sodiumData) {
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('resultCard').style.display = 'block';
  document.getElementById('printBtn').style.display = 'inline-flex';

  document.getElementById('scaleBadge').textContent = `${from}人前 → ${to}人前  ×${fmtN(ratio)}`;

  const tbody = document.getElementById('resultBody');
  tbody.innerHTML = '';

  let totalKcal = 0, hasKcal = false;

  results.forEach((ing, idx) => {
    if (ing.nutr) { totalKcal += ing.nutr.kcal; hasKcal = true; }
    const subs  = getSubstitute(ing.name);
    const subId = `sub-${idx}`;

    const allergenMinis = ing.allergens && ing.allergens.length
      ? `<div class="ing-allergens">${ing.allergens.map(a=>`<span class="a-mini">${escHtml(a.label)}</span>`).join('')}</div>`
      : '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><div class="ing-name">${escHtml(ing.name)}</div>${allergenMinis}</td>
      <td>
        <div class="ing-amount">${escHtml(ing.display)}</div>
        ${ing.note ? `<div class="ing-note">${escHtml(ing.note)}</div>` : ''}
        ${ing.ambiguousNote ? `<div class="ing-ambiguous">${escHtml(ing.ambiguousNote)}</div>` : ''}
      </td>
      <td class="ing-calorie">
        ${ing.nutr !== null
          ? `${Math.round(ing.nutr.kcal)}<span style="font-size:10px;color:var(--text3)"> kcal</span>`
          : `<span style="color:var(--text3)">—</span>`}
      </td>
      <td>
        ${subs
          ? `<button class="btn btn-ghost" id="btn-${subId}" onclick="toggleSub('${subId}')">代替</button>
             <div class="sub-panel" id="${subId}">
               <div class="sub-title">代替食材</div>
               <ul class="sub-list">${subs.map(s=>`<li>${escHtml(s)}</li>`).join('')}</ul>
             </div>`
          : `<span style="color:var(--text3);font-size:12px">—</span>`}
      </td>`;
    tbody.appendChild(tr);
  });

  // Store for diet highlight & show diet bar
  _lastResults = results;
  document.getElementById('dietBar').style.display = 'flex';
  applyDietHighlight();

  // 鶏肉の皮トグル（もも・むね・手羽を含む場合のみ表示）
  const hasChickenSkin = results.some(r => /鶏|チキン|手羽/.test(r.name) && /もも|むね|手羽/.test(r.name));
  const skinBar = document.getElementById('skinBar');
  if (skinBar) {
    skinBar.style.display = hasChickenSkin ? 'flex' : 'none';
    document.getElementById('chip-skin-with').classList.toggle('active', _chickenSkinPref === 'with');
    document.getElementById('chip-skin-without').classList.toggle('active', _chickenSkinPref === 'without');
  }

  const totalRow = document.getElementById('totalRow');
  if (hasKcal) {
    totalRow.style.display = 'flex';
    document.getElementById('totalCalorie').textContent = `${Math.round(totalKcal)} kcal`;
    document.getElementById('totalPer').textContent = `（${to}人前合計）`;
  } else {
    totalRow.style.display = 'none';
  }

  // Allergen + Sodium section
  renderAllergenSection(results, sodiumData, to);

  // Cost section
  initCostSection(results, to);

  // Nutrition section
  if (_nutrTotal) {
    document.getElementById('nutrSection').style.display = 'block';
    document.getElementById('toggleTotal').classList.add('active');
    document.getElementById('togglePer').classList.remove('active');
    renderNutrition(_nutrTotal, to, 'total');
  } else {
    document.getElementById('nutrSection').style.display = 'none';
  }
}

function renderAllergenSection(results, sodiumData, toPerson) {
  const section = document.getElementById('allergenSection');
  const allNames = results.map(r => r.name);
  const found = detectAllAllergens(allNames);

  // Always show the section
  section.style.display = 'flex';

  // Pills
  const pillsEl = document.getElementById('allergenPills');
  if (found.size === 0) {
    pillsEl.innerHTML = '<span class="a-none">検出されませんでした</span>';
  } else {
    pillsEl.innerHTML = [...found.entries()]
      .sort((a,b) => (b[1]?1:0) - (a[1]?1:0)) // mandatory first
      .map(([label, mandatory]) =>
        `<span class="a-pill ${mandatory ? 'a-pill-mandatory' : 'a-pill-advisory'}">${escHtml(label)}</span>`
      ).join('');
  }

  // Sodium bar
  const sodiumWrap = document.getElementById('sodiumWrap');
  if (!sodiumData) { sodiumWrap.style.display = 'none'; return; }
  sodiumWrap.style.display = 'flex';

  const totalG = sodiumData.total / 1000; // mg → g
  const perG   = sodiumData.per   / 1000;
  document.getElementById('sodiumTotal').textContent = `${totalG.toFixed(2)}g`;
  document.getElementById('sodiumPer').textContent   = `（1人前 ${perG.toFixed(2)}g）`;

  // WHO目標: 5g/日, 日本目標: 男7.5g 女6.5g/日 → 1食分=1/3として警告
  const DAILY_TARGET = 6.5; // g/日（成人女性基準・厳し目）
  const pct = Math.min((totalG / DAILY_TARGET) * 100, 100);
  const color = totalG <= 2 ? '#6bffb8' : totalG <= 4 ? '#ffb347' : '#ff7b7b';
  document.getElementById('sodiumFill').style.cssText = `width:${pct}%;background:${color}`;
  document.getElementById('sodiumLimit').textContent =
    `日本食塩摂取目標（${toPerson}人前全体）：${totalG.toFixed(2)}g / 目安6.5g/日`;
}

function toggleSub(id) {
  const panel = document.getElementById(id);
  const btn   = document.getElementById(`btn-${id}`);
  const open  = panel.classList.toggle('open');
  btn.textContent = open ? '閉じる' : '代替';
  btn.classList.toggle('btn-alt', open);
  btn.classList.toggle('btn-ghost', !open);
}

// ══════════════════════════════════════════
// NUTRITION CHART
// ══════════════════════════════════════════

function setNutrView(mode) {
  _nutrView = mode;
  document.getElementById('toggleTotal').classList.toggle('active', mode==='total');
  document.getElementById('togglePer').classList.toggle('active',   mode==='per');
  const toPerson = parseFloat(document.getElementById('toPerson').value) || 1;
  const data = mode === 'total' ? _nutrTotal : _nutrPer;
  if (data) renderNutrition(data, toPerson, mode);
}

function renderNutrition(data, toPerson, mode) {
  const { kcal, p, f, c } = data;
  const totalMacro = p + f + c;

  // Draw donut
  const canvas = document.getElementById('nutritionChart');
  drawDonut(canvas, p, f, c);

  // Legend
  const legend = document.getElementById('nutrLegend');
  const macros = [
    { label:'タンパク質', val:p, color:'var(--p-color)', kcalPer:4 },
    { label:'脂質',       val:f, color:'var(--f-color)', kcalPer:9 },
    { label:'炭水化物',   val:c, color:'var(--c-color)', kcalPer:4 },
  ];

  legend.innerHTML = macros.map(m => {
    const pct = totalMacro > 0 ? Math.round(m.val / totalMacro * 100) : 0;
    return `
    <div class="nutr-item">
      <div class="nutr-item-header">
        <span class="nutr-dot-label">
          <span class="nutr-dot" style="background:${m.color}"></span>
          ${escHtml(m.label)}
        </span>
        <span>
          <span class="nutr-val" style="color:${m.color}">${m.val.toFixed(1)}g</span>
          <span class="nutr-pct">${pct}%</span>
        </span>
      </div>
      <div class="nutr-bar-track">
        <div class="nutr-bar-fill" style="width:${pct}%;background:${m.color}"></div>
      </div>
    </div>`;
  }).join('');

  const label = mode === 'total' ? `${toPerson}人前合計` : `1人前あたり`;
  document.getElementById('nutrKcalNote').textContent =
    `${label}：エネルギー ${Math.round(kcal)} kcal｜タンパク質 ${p.toFixed(1)}g｜脂質 ${f.toFixed(1)}g｜炭水化物 ${c.toFixed(1)}g`;
}

function drawDonut(canvas, p, f, c) {
  const size = 320; // logical 160px × 2 for retina
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2); // retina scale; draw at 160×160

  const cx = 80, cy = 80;
  const outerR = 68, innerR = 44;
  const total = p + f + c;

  if (total <= 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI*2);
    ctx.arc(cx, cy, innerR, 0, Math.PI*2, true);
    ctx.fillStyle = '#2e2e2e';
    ctx.fill();
    return;
  }

  const segments = [
    { val:p, color:'#6bffb8' },
    { val:f, color:'#ff7b7b' },
    { val:c, color:'#e8ff3c' },
  ];
  const GAP = 0.03;
  let angle = -Math.PI / 2;

  for (const seg of segments) {
    if (seg.val <= 0) continue;
    const sweep = (seg.val / total) * (Math.PI*2 - GAP * segments.length);

    ctx.beginPath();
    ctx.arc(cx, cy, outerR, angle + GAP/2, angle + sweep + GAP/2);
    // Inner arc (reversed for donut shape)
    ctx.arc(cx, cy, innerR, angle + sweep + GAP/2, angle + GAP/2, true);
    ctx.closePath();
    ctx.fillStyle = seg.color;
    ctx.fill();
    angle += sweep + GAP;
  }

  // Center text
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f0f0f0';
  ctx.font = 'bold 14px "DM Mono", monospace';
  ctx.fillText(`${(p+f+c).toFixed(0)}g`, cx, cy - 7);
  ctx.font = '10px "Zen Kaku Gothic New", sans-serif';
  ctx.fillStyle = '#666';
  ctx.fillText('PFC合計', cx, cy + 9);
}

// ══════════════════════════════════════════
// VOICE INPUT  (Web Speech API)