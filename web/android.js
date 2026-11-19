// A small Android view system for the browser: it reads the app's own res/ folder
// (layouts, colours, styles, shape drawables, PNGs and fonts, copied next to web/ by the
// pages workflow) and inflates res/layout XML into DOM elements, the way LayoutInflater
// turns it into Views on the phone. Only what DichBoxMobile's layouts use is supported.

const RES = '../app/src/main/res/';
const DP = 1; // one dp is one CSS pixel inside the phone screen

export const res = {
  files: new Set(),        // every path under res/, from res-index.txt
  colors: {},              // @color/name -> #rrggbb / rgba()
  styles: {},              // @style/name -> { attr: value }
  themes: {},              // values / values-night Theme.DichBoxMobile items
  layouts: {},             // name -> parsed XML document
  drawables: {},           // name -> parsed XML document (shapes, layer-lists, selectors)
  menus: {},               // res/menu
};

const ANDROID_NS = 'http://schemas.android.com/apk/res/android';

const parseXml = (text) => new DOMParser().parseFromString(text, 'application/xml');
const fetchText = async (path) => {
  const r = await fetch(RES + path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.text();
};

/** Loads the resource index and every XML resource the app has (about 80 small files). */
export async function loadResources() {
  const index = await (await fetch('res-index.txt')).text();
  index.split('\n').map((l) => l.trim().replace(/^\.\//, '')).filter(Boolean).forEach((p) => res.files.add(p));
  const xml = [...res.files].filter((p) => p.endsWith('.xml'));
  const docs = await Promise.all(xml.map(async (p) => [p, parseXml(await fetchText(p))]));
  for (const [path, doc] of docs) {
    const [dir, file] = path.split('/');
    const name = file.replace(/\.xml$/, '');
    if (dir === 'layout') res.layouts[name] = doc;
    else if (dir.startsWith('drawable')) res.drawables[name] = doc;
    else if (dir === 'menu') res.menus[name] = doc;
    else if (dir === 'values' || dir === 'values-v21' || dir === 'values-night') {
      doc.querySelectorAll('color').forEach((c) => { res.colors[c.getAttribute('name')] = argb(c.textContent.trim()); });
      doc.querySelectorAll('style').forEach((s) => {
        const items = {};
        s.querySelectorAll('item').forEach((i) => { items[i.getAttribute('name').replace(/^android:/, '')] = i.textContent.trim(); });
        if (s.getAttribute('name') === 'Theme.DichBoxMobile') res.themes[dir] = items;
        else res.styles[s.getAttribute('name')] = { ...(res.styles[s.getAttribute('name')] || {}), ...items };
      });
    }
  }
  // fonts from res/font
  await Promise.all([...res.files].filter((p) => p.startsWith('font/')).map(async (p) => {
    const name = p.slice(5).replace(/\.ttf$/, '');
    const data = repairFont(await (await fetch(RES + p)).arrayBuffer());
    const face = new FontFace(name, data);
    document.fonts.add(await face.load());
  }));
}

/**
 * dynar_shadow_c.ttf has a malformed table directory and a cmap whose final 0xFFFF segment
 * maps to glyph 65535. Android's font loader shrugs that off; browsers reject the whole font.
 * The copy in memory gets the two fields fixed (the file in res/font is left as it is).
 */
function repairFont(buffer) {
  const v = new DataView(buffer);
  const numTables = v.getUint16(4);
  const pow = 2 ** Math.floor(Math.log2(numTables));
  v.setUint16(6, pow * 16);
  v.setUint16(8, Math.log2(pow));
  v.setUint16(10, numTables * 16 - pow * 16);
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + 16 * i;
    const tag = String.fromCharCode(...new Uint8Array(buffer, rec, 4));
    if (tag !== 'cmap') continue;
    const cmap = v.getUint32(rec + 8);
    const subtables = v.getUint16(cmap + 2);
    for (let j = 0; j < subtables; j++) {
      const sub = cmap + v.getUint32(cmap + 4 + 8 * j + 4);
      if (v.getUint16(sub) !== 4) continue;
      const segX2 = v.getUint16(sub + 6);
      const last = segX2 - 2;
      const ends = sub + 14, starts = ends + segX2 + 2, deltas = starts + segX2, offsets = deltas + segX2;
      if (v.getUint16(ends + last) === 0xffff && v.getUint16(starts + last) === 0xffff && v.getUint16(offsets + last) === 0) v.setUint16(deltas + last, 1);
    }
  }
  return buffer;
}

/** #AARRGGBB / #RRGGBB -> CSS colour. */
function argb(hex) {
  const h = hex.replace('#', '');
  if (h.length !== 8) return '#' + h.toLowerCase();
  const a = parseInt(h.slice(0, 2), 16) / 255;
  const rgb = '#' + h.slice(2).toLowerCase();
  return a === 1 ? rgb : `rgba(${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${parseInt(h.slice(6, 8), 16)}, ${a.toFixed(3)})`;
}

export function color(ref) {
  if (!ref) return null;
  if (ref.startsWith('#')) return argb(ref);
  if (ref === '@android:color/transparent' || ref === '@null') return 'transparent';
  const m = /^@color\/(.+)$/.exec(ref);
  return m ? res.colors[m[1]] : null;
}

/** Theme attribute from values/ or values-night/ (the page theme picks which). */
export function themeAttr(name) {
  const night = document.documentElement.dataset.theme === 'dark'
    || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const theme = { ...res.themes.values, ...(night ? res.themes['values-night'] : {}) };
  let v = theme[name];
  if (v?.startsWith('?attr/')) v = theme[v.slice(6)];
  return color(v);
}

const DENSITIES = ['xxxhdpi', 'xxhdpi', 'xhdpi', 'hdpi', 'mdpi'];

/** @drawable/x or @mipmap/x -> URL of the sharpest PNG the app ships for it. */
export function bitmap(ref) {
  const m = /^@(drawable|mipmap)\/(.+)$/.exec(ref || '');
  if (!m) return null;
  const [, kind, name] = m;
  const kinds = kind === 'mipmap' ? ['mipmap', 'drawable'] : ['drawable', 'mipmap'];
  for (const k of kinds) for (const d of DENSITIES) {
    const p = `${k}-${d}/${name}.png`;
    if (res.files.has(p)) return RES + p;
  }
  return null;
}

export const dp = (v) => {
  if (v == null) return null;
  if (v === '?attr/actionBarSize') return 56 * DP;
  const m = /^(-?[\d.]+)(dp|sp|px|dip)?$/.exec(v);
  return m ? parseFloat(m[1]) * DP : null;
};

/** A shape / layer-list drawable as CSS declarations. */
export function drawableCss(name) {
  const doc = res.drawables[name];
  if (!doc) {
    const url = bitmap('@drawable/' + name);
    return url ? { backgroundImage: `url("${url}")`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' } : {};
  }
  const root = doc.documentElement;
  const css = { border: '0', boxShadow: 'none', borderRadius: '0', backgroundColor: 'transparent', backgroundImage: 'none' };
  const a = (el, n) => el.getAttributeNS(ANDROID_NS, n) ?? el.getAttribute('android:' + n);
  const shape = (s) => {
    const out = {};
    const solid = s.querySelector('solid'), stroke = s.querySelector('stroke'), corners = s.querySelector('corners');
    if (solid) out.fill = color(a(solid, 'color'));
    if (stroke) out.stroke = { w: dp(a(stroke, 'width')), c: color(a(stroke, 'color')), dashed: !!a(stroke, 'dashWidth') };
    if (corners) out.radius = dp(a(corners, 'radius'));
    out.oval = a(s, 'shape') === 'oval';
    return out;
  };
  if (root.localName === 'shape') {
    const s = shape(root);
    if (s.fill) css.backgroundColor = s.fill;
    if (s.stroke) css.border = `${s.stroke.w}px ${s.stroke.dashed ? 'dashed' : 'solid'} ${s.stroke.c}`;
    if (s.radius) css.borderRadius = s.radius + 'px';
    if (s.oval) css.borderRadius = '50%';
    return css;
  }
  if (root.localName === 'layer-list') {
    const items = [...root.querySelectorAll(':scope > item')];
    const shadows = [];
    items.forEach((item, i) => {
      const s = shape(item.querySelector('shape'));
      const inset = Object.fromEntries(['left', 'top', 'right', 'bottom'].map((k) => [k, dp(a(item, k)) ?? 0]));
      const allSides = Object.values(inset).every((v) => v >= 0);
      if (i === 0 && allSides) {
        if (s.fill) css.backgroundColor = s.fill;
        if (s.stroke) css.border = `${s.stroke.w}px solid ${s.stroke.c}`;
      } else if (allSides && s.stroke) {
        // an inner frame inset from the outer one (double_border)
        const outer = shape(items[0].querySelector('shape')).stroke?.w ?? 0;
        const gap = inset.left - outer;
        shadows.push(`inset 0 0 0 ${gap}px ${css.backgroundColor}`, `inset 0 0 0 ${gap + s.stroke.w}px ${s.stroke.c}`);
      } else if (s.stroke) {
        // sides pushed outside the bounds (negative insets) are not drawn
        const style = s.stroke.dashed ? 'dashed' : 'solid';
        for (const side of ['left', 'top', 'right', 'bottom']) {
          if (inset[side] >= 0) css['border' + side[0].toUpperCase() + side.slice(1)] = `${s.stroke.w}px ${style} ${s.stroke.c}`;
        }
      }
    });
    if (shadows.length) css.boxShadow = shadows.join(', ');
    return css;
  }
  return css;
}

export function applyBackground(el, ref) {
  if (!ref) return;
  if (ref === '@null') { el.style.background = 'none'; el.style.border = '0'; return; }
  const c = color(ref);
  if (c) { el.style.backgroundColor = c; return; }
  const m = /^@drawable\/(.+)$/.exec(ref);
  if (m) Object.assign(el.style, drawableCss(m[1]));
}

// ------------------------------------------------------------------- inflater --

const SHORT = (tag) => tag.split('.').pop();
const LAYOUTS = new Set(['LinearLayout', 'FrameLayout', 'RelativeLayout', 'ConstraintLayout', 'GridLayout', 'RadioGroup',
  'ScrollView', 'NestedScrollView', 'HorizontalScrollView', 'SwipeRefreshLayout']);

/** Attributes of an element after its style="@style/…" (style first, element wins). */
function attrsOf(el) {
  const out = {};
  const style = el.getAttribute('style');
  if (style) Object.assign(out, res.styles[style.replace('@style/', '')] || {});
  for (const at of el.attributes) {
    if (at.name === 'style' || at.name.startsWith('xmlns')) continue;
    out[at.name.replace(/^(android|app|tools):/, at.name.startsWith('app:') ? 'app:' : '')] = at.value;
  }
  return out;
}

const idName = (v) => v?.replace(/^@\+?id\//, '') ?? null;

/**
 * Inflates res/layout/<name>.xml. `extra` holds the attributes of an <include> tag, which
 * override the included root's id, layout_* and visibility, like LayoutInflater does.
 */
export function inflate(name, extra = null) {
  const doc = res.layouts[name];
  if (!doc) throw new Error(`No layout ${name}`);
  return build(doc.documentElement, extra);
}

function build(node, extra) {
  const tag = SHORT(node.tagName);
  if (tag === 'include') {
    const a = attrsOf(node);
    return inflate(a.layout.replace('@layout/', ''), a);
  }
  const a = { ...attrsOf(node) };
  if (extra) for (const [k, v] of Object.entries(extra)) if (k === 'id' || k.startsWith('layout_') || k === 'visibility') a[k] = v;
  const el = create(tag, a);
  el._attrs = a;
  el.classList.add('av', 'av-' + tag);
  if (a.id) el.dataset.id = idName(a.id);
  const kids = [...node.children];
  const host = el._content || el;
  for (const k of kids) {
    const child = build(k, null);
    host.appendChild(child);
  }
  return el;
}

function create(tag, a) {
  let el;
  switch (tag) {
    case 'TextView':
      el = document.createElement('div');
      el.textContent = a.text ?? '';
      break;
    case 'EditText': {
      const multi = a.inputType === 'textMultiLine' || Number(a.lines) > 1 || /top/.test(a.gravity || '');
      el = document.createElement('div');
      const input = document.createElement(multi ? 'textarea' : 'input');
      if (!multi) input.type = a.inputType === 'textPassword' ? 'password' : a.inputType === 'textEmailAddress' ? 'email' : 'text';
      input.placeholder = a.hint ?? '';
      input.spellcheck = false;
      input.autocomplete = 'off';
      if (a.maxLength) input.maxLength = Number(a.maxLength);
      if (a.enabled === 'false') input.disabled = true;
      if (a.hint) input.setAttribute('aria-label', a.hint);
      el.appendChild(input);
      el._input = input;
      break;
    }
    case 'Button': case 'AppCompatButton':
      el = document.createElement('button');
      el.type = 'button';
      el.textContent = a.text ?? '';
      break;
    case 'ImageView': case 'CircleImageView': case 'PhotoView': {
      el = document.createElement('div');
      const img = document.createElement('img');
      img.alt = a.contentDescription ?? '';
      img.draggable = false;
      const src = bitmap(a.src || a['app:srcCompat']);
      if (src) img.src = src; else img.hidden = true;
      // a wrap_content ImageView takes the bitmap's size in dp (pixels / density)
      img.addEventListener('load', () => {
        if (el.style.width || tag !== 'ImageView') return;
        const d = { xxxhdpi: 4, xxhdpi: 3, xhdpi: 2, hdpi: 1.5, mdpi: 1 }[/-(\w+dpi)\//.exec(img.src)?.[1]] || 1;
        img.style.width = img.naturalWidth / d + 'px';
      });
      el.appendChild(img);
      el._img = img;
      break;
    }
    case 'FloatingActionButton': {
      el = document.createElement('button');
      el.type = 'button';
      el.setAttribute('aria-label', a.contentDescription ?? '');
      const img = document.createElement('img');
      img.alt = '';
      img.src = bitmap(a.src);
      if (a['app:maxImageSize']) img.style.width = img.style.height = dp(a['app:maxImageSize']) + 'px';
      el.appendChild(img);
      break;
    }
    case 'Spinner':
      el = document.createElement('div');
      el._select = document.createElement('select');
      el._select.setAttribute('aria-label', 'Boxes type');
      el.appendChild(el._select);
      break;
    case 'RadioButton': {
      el = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      const span = document.createElement('span');
      span.textContent = a.text ?? '';
      el.append(input, span);
      el._input = input;
      break;
    }
    case 'TabLayout':
      el = document.createElement('div');
      el.setAttribute('role', 'tablist');
      break;
    case 'Toolbar':
      el = document.createElement('div');
      el._title = document.createElement('div');
      el._title.className = 'av-title';
      el.appendChild(el._title);
      break;
    case 'SwipeRefreshLayout':
      el = document.createElement('div');
      break;
    default:
      el = document.createElement('div');
  }
  styleView(el, tag, a);
  return el;
}

function styleView(el, tag, a) {
  const s = el.style;
  // layout params are resolved once the parent is known (see layoutParams)
  if (a.background) applyBackground(el, a.background);
  if (a.backgroundTint && tag === 'FloatingActionButton') s.backgroundColor = color(a.backgroundTint);
  const pad = (k) => dp(a['padding' + k]);
  const p = dp(a.padding);
  const top = pad('Top') ?? p, bottom = pad('Bottom') ?? p, start = pad('Start') ?? pad('Left') ?? p, end = pad('End') ?? pad('Right') ?? p;
  if (top != null) s.paddingTop = top + 'px';
  if (bottom != null) s.paddingBottom = bottom + 'px';
  if (start != null) s.paddingLeft = start + 'px';
  if (end != null) s.paddingRight = end + 'px';
  if (a.minHeight && tag !== 'CircleImageView') s.minHeight = dp(a.minHeight) + 'px';
  if (a.elevation) s.zIndex = '2';
  if (a.visibility === 'gone') el.classList.add('gone');
  if (a.visibility === 'invisible') s.visibility = 'hidden';
  const text = ['TextView', 'EditText', 'Button', 'AppCompatButton', 'RadioButton'].includes(tag);
  if (text) {
    const target = el._input || el;
    if (a.textSize) target.style.fontSize = dp(a.textSize) + 'px';
    if (a.textColor) { const c = color(a.textColor); target.style.color = c; el.style.color = c; }
    if (a.textColorHint) el.style.setProperty('--hint', color(a.textColorHint));
    if (a.textStyle?.includes('bold')) target.style.fontWeight = '700';
    if (a.textStyle?.includes('italic')) target.style.fontStyle = 'italic';
    if (a.textStyle === 'normal') target.style.fontStyle = 'normal';
    if (a.fontFamily) target.style.fontFamily = `"${a.fontFamily.replace('@font/', '')}", serif`;
    if (a.textAllCaps === 'false') s.textTransform = 'none';
    if (a.textAllCaps === 'true') s.textTransform = 'uppercase';
    const g = a.gravity || '';
    if (tag === 'TextView' && /center_vertical|^center$/.test(g)) el.classList.add('vcenter');
    if (/center_horizontal|^center$|\|center$|center\|/.test(g)) target.style.textAlign = 'center';
    else if (/end/.test(g)) target.style.textAlign = 'right';
    if (tag === 'EditText') {
      el.style.setProperty('--tint', color(a.backgroundTint) || res.colors.light_blue);
      if (a.background) el.classList.add('framed');
      if (a.lines) el._input.rows = Number(a.lines);
    }
  }
  if (tag === 'CircleImageView') {
    const w = dp(a['app:civ_border_width']) ?? 0;
    el.style.setProperty('--civ', `${w}px solid ${color(a['app:civ_border_color'])}`);
    const size = dp(a.minWidth);
    if (size) { s.width = size + 'px'; s.height = size + 'px'; }
  }
  if (tag === 'LinearLayout' || tag === 'RadioGroup') {
    const vertical = a.orientation === 'vertical' || tag === 'RadioGroup';
    el.classList.add(vertical ? 'v' : 'h');
    const g = a.gravity || '';
    const main = vertical ? (/center_vertical|^center$/.test(g) ? 'center' : /bottom/.test(g) ? 'flex-end' : null)
      : (/center_horizontal|^center$/.test(g) ? 'center' : /end/.test(g) ? 'flex-end' : null);
    const cross = vertical ? (/center_horizontal|^center$/.test(g) ? 'center' : /end/.test(g) ? 'flex-end' : null)
      : (/center_vertical|^center$/.test(g) ? 'center' : /bottom/.test(g) ? 'flex-end' : null);
    if (main) s.justifyContent = main;
    if (cross) s.alignItems = cross;
  }
  if (tag === 'GridLayout') s.gridTemplateColumns = `repeat(${a.columnCount || 1}, auto)`;
  if (tag === 'ListView' && a.dividerHeight) s.gap = dp(a.dividerHeight) + 'px';
  if (tag === 'ScrollView' && a.fillViewport === 'true') el.classList.add('fill');
}

/**
 * Resolves layout_width/height/margins/gravity of every view against its parent, after the
 * tree is built: LinearLayout is a flexbox, Frame/Constraint layouts stack their children,
 * RelativeLayout flows them top to bottom with the alignParentBottom ones pinned.
 */
export function layoutTree(el) {
  const kids = [...(el._content || el).children].filter((c) => c._attrs);
  const kind = parentKind(el);
  for (const c of kids) { layoutParams(c, kind, el); layoutTree(c); }
}

function parentKind(el) {
  const tag = [...el.classList].find((c) => c.startsWith('av-'))?.slice(3);
  if (tag === 'LinearLayout' || tag === 'RadioGroup') return el.classList.contains('v') ? 'v' : 'h';
  if (tag === 'RelativeLayout') return 'rel';
  if (tag === 'GridLayout') return 'grid';
  if (['ScrollView', 'NestedScrollView', 'HorizontalScrollView', 'SwipeRefreshLayout'].includes(tag)) return 'scroll';
  return 'stack';
}

function layoutParams(c, kind, parent) {
  const a = c._attrs, s = c.style;
  const w = a.layout_width, h = a.layout_height;
  const fill = (v) => v === 'match_parent' || v === 'fill_parent';
  const m = (k) => dp(a['layout_margin' + k]);
  const mm = dp(a.layout_margin);
  const mt = m('Top') ?? mm, mb = m('Bottom') ?? mm, ms = m('Start') ?? m('Left') ?? mm, me = m('End') ?? m('Right') ?? mm;
  if (mt != null) s.marginTop = mt + 'px';
  if (mb != null) s.marginBottom = mb + 'px';
  if (ms != null) s.marginLeft = ms + 'px';
  if (me != null) s.marginRight = me + 'px';
  const fixedW = dp(w), fixedH = dp(h);
  const lg = a.layout_gravity || '';
  const weight = Number(a.layout_weight || 0);
  // ListViews scroll inside whatever room is left, everything else keeps its size
  const list = c.classList.contains('av-ListView');
  s.flexShrink = list ? '1' : '0';
  if (list) s.minHeight = '0';
  if (kind === 'v' || kind === 'h') {
    const vertical = kind === 'v';
    const [mainSize, crossSize] = vertical ? [h, w] : [w, h];
    const [fixedMain, fixedCross] = vertical ? [fixedH, fixedW] : [fixedW, fixedH];
    if (weight && (fixedMain === 0 || !fixedMain)) { s.flex = `${weight} 1 0`; s.minWidth = s.minHeight = '0'; }
    else if (fixedMain != null) s[vertical ? 'height' : 'width'] = fixedMain + 'px';
    else if (fill(mainSize)) {
      if (vertical) { s.flexGrow = '1'; s.minHeight = '0'; } else { s.flex = '1 1 0'; s.minWidth = '0'; }
    }
    if (fixedCross != null) s[vertical ? 'width' : 'height'] = fixedCross + 'px';
    else if (fill(crossSize)) s.alignSelf = 'stretch';
    const cross = vertical ? (/center_horizontal|^center$/.test(lg) ? 'center' : /end|right/.test(lg) ? 'flex-end' : /start|left/.test(lg) ? 'flex-start' : null)
      : (/center_vertical|^center$/.test(lg) ? 'center' : /bottom/.test(lg) ? 'flex-end' : null);
    if (cross && !fill(crossSize)) s.alignSelf = cross;
    if (!vertical && fixedCross == null && !fill(crossSize) && !cross) s.alignSelf = s.alignSelf || 'flex-start';
  } else if (kind === 'stack' || kind === 'scroll') {
    if (fixedW != null) s.width = fixedW + 'px'; else if (fill(w)) s.justifySelf = 'stretch';
    if (fixedH != null) s.height = fixedH + 'px';
    else if (fill(h) && kind === 'stack') s.alignSelf = 'stretch';
    // inside a SwipeRefreshLayout the child fills it; inside a ScrollView it is at least as tall
    else if (fill(h)) s[parent?.classList.contains('av-SwipeRefreshLayout') ? 'height' : 'minHeight'] = '100%';
    if (kind === 'stack') {
      const hz = /center_horizontal|^center$/.test(lg) ? 'center' : /end/.test(lg) ? 'end' : null;
      const vt = /center_vertical|^center$/.test(lg) ? 'center' : /bottom/.test(lg) ? 'end' : null;
      if (hz) s.justifySelf = hz;
      if (vt) s.alignSelf = vt;
      if (!fill(w) && fixedW == null && !hz) s.justifySelf = 'start';
      if (!fill(h) && fixedH == null && !vt) s.alignSelf = 'start';
      // ConstraintLayout children pinned to the parent's bottom / centred horizontally
      if (a['app:layout_constraintBottom_toBottomOf'] === 'parent' && !a['app:layout_constraintTop_toTopOf']) s.alignSelf = 'end';
      if (a['app:layout_constraintStart_toStartOf'] === 'parent' && a['app:layout_constraintEnd_toEndOf'] === 'parent' && !fill(w)) s.justifySelf = 'center';
    }
  } else if (kind === 'rel') {
    if (fixedW != null) s.width = fixedW + 'px'; else if (fill(w)) s.alignSelf = 'stretch'; else s.alignSelf = 'flex-start';
    if (fixedH != null) s.height = fixedH + 'px'; else if (fill(h)) { s.flex = '1 1 auto'; s.minHeight = '0'; }
    if (a.layout_centerHorizontal === 'true') s.alignSelf = 'center';
    if (a.layout_alignParentBottom === 'true' && !a.layout_below) {
      c.classList.add('pinned-bottom');
      if (a.layout_alignParentEnd === 'true') c.classList.add('pinned-end');
    }
  } else if (kind === 'grid') {
    if (a.layout_row) s.gridRow = Number(a.layout_row) + 1;
    if (a.layout_column) s.gridColumn = `${Number(a.layout_column) + 1} / span ${a.layout_columnSpan || 1}`;
    if (fixedW != null) s.width = fixedW + 'px';
    if (fixedH != null) s.height = fixedH + 'px';
    if (/center_vertical/.test(lg)) s.alignSelf = 'center';
    if (a.layout_column === '3') s.justifySelf = 'end';
  }
}

/** findViewById over an inflated tree. */
export const find = (root, id) => (root.dataset?.id === id ? root : root.querySelector(`[data-id="${id}"]`));

/** Inflate + lay out, ready to insert. */
export function view(name, extra) {
  const el = inflate(name, extra);
  layoutParams(el, 'stack', null);
  layoutTree(el);
  return el;
}
