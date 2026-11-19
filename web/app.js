// DichBoxMobile in the browser. The screens are the app's own res/layout files inflated by
// android.js; the fragment logic below is a JavaScript port of the app's view/ and mv/
// classes (same flow, same texts, same state holders). Whatever the app does through its
// platform-independent Kotlin runs that Kotlin, compiled to WebAssembly from the app's
// sources (web/kotlin): every API request (UserAPI/BoxesAPI over Retrofit/Gson stand-ins),
// the request/response data classes, the sign-in/up verifiers that colour the inputs and
// enable the buttons, the field templates and warnings, notification messages, the
// profile decorators and the opened files tab state.
import { loadResources, view, find, color, bitmap, applyBackground, drawableCss, themeAttr, dp, res } from './android.js';
import { initMock, handleRequest, demoCredentials } from './mock/server.js';

const $ = (s, r = document) => r.querySelector(s);
const C = () => res.colors;
// tools/AppColors.kt raw values as CSS
const APP = { BLACK: '#000000', CRIMSON: '#dc143c', GREEN: '#00ff4c', BLUE: '#00d9ff', GRAY: '#808080', PURPLE: '#ba00e9', ORANGE: '#ffa500' };

let kt; // the Kotlin/Wasm module (web/kotlin-wasm/dichbox.mjs)

// -------------------------------------------------------------- Kotlin bridge --

const handles = new Map();
let nextHandle = 1;
const h = (el) => { if (!el._h) { el._h = nextHandle++; handles.set(el._h, el); } return el._h; };

/** Renders {"text","spans"} from the Kotlin TextView stand-in (SpannableString spans). */
function renderSpans(el, { text, spans }) {
  if (!spans.length) { el.textContent = text; return; }
  const box = document.createElement('span');
  const cuts = new Set([0, text.length]);
  spans.forEach((s) => { cuts.add(Math.max(0, Math.min(text.length, s.start))); cuts.add(Math.max(0, Math.min(text.length, s.end))); });
  const points = [...cuts].sort((a, b) => a - b);
  for (let i = 0; i < points.length - 1; i++) {
    const [from, to] = [points[i], points[i + 1]];
    const span = document.createElement('span');
    span.textContent = text.slice(from, to);
    for (const s of spans) {
      if (s.start > from || s.end < to) continue;
      if (s.color) span.style.color = s.color;
      if (s.style === 0) { span.style.fontStyle = 'normal'; span.style.fontWeight = '400'; }
      if (s.style === 1) span.style.fontWeight = '700';
      if (s.style === 2) span.style.fontStyle = 'italic';
    }
    box.appendChild(span);
  }
  el.replaceChildren(box);
}

globalThis.__ktView = (handle, key, value) => {
  const el = handles.get(handle);
  if (!el) return;
  switch (key) {
    case 'text': {
      const data = JSON.parse(value);
      if (el._input) el._input.value = data.text; else renderSpans(el, data);
      break;
    }
    case 'textColor': (el._input || el).style.color = value; break;
    case 'tint': el.style.setProperty('--tint', value); break;
    case 'enabled': if (el._input) el._input.disabled = value !== 'true'; else el.disabled = value !== 'true'; break;
    case 'visibility': el.classList.toggle('gone', value === '8'); break;
    case 'background': Object.assign(el.style, drawableCss(value)); break;
  }
};

globalThis.__dichboxPost = (url, body) => {
  const [status, json] = handleRequest(url, JSON.parse(body));
  return `${status}\n${JSON.stringify(json)}`;
};

let onSigned = () => {};
globalThis.__ktSigned = (name, uuid) => onSigned(name, uuid);


/** One call of the app's UserAPI/BoxesAPI (Kotlin), returning [status, response container]. */
function api(method, request) {
  const r = JSON.parse(kt.api(method, JSON.stringify(request)));
  return [r.status, r.body];
}

// ----------------------------------------------------------------- LiveData --

/**
 * androidx LiveData semantics: every setValue() notifies, but a value set while observers are
 * being notified doesn't recurse; the dispatch restarts with the latest value instead, and an
 * observer never sees the same version twice.
 */
class LiveData {
  constructor(value) { this.value = value; this.version = 0; this.obs = new Set(); this.dispatching = false; this.invalidated = false; }
  set(v) {
    this.value = v;
    this.version++;
    if (this.dispatching) { this.invalidated = true; return; }
    this.dispatching = true;
    do {
      this.invalidated = false;
      for (const o of [...this.obs]) {
        if (!this.obs.has(o) || o.last >= this.version) continue;
        o.last = this.version;
        o.fn(this.value);
        if (this.invalidated) break;
      }
    } while (this.invalidated);
    this.dispatching = false;
  }
  observe(owner, fn) {
    const o = { fn, last: this.version };
    this.obs.add(o);
    owner.onDispose(() => this.obs.delete(o));
  }
}

/** Kotlin's == on data classes (structural equality). */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ViewModels shared by the activity (ViewModelProvider(requireActivity()))
const vm = {
  names: new LiveData([null, null]),      // UserStateViewModel.namesState
  userData: new LiveData(null),           // UserDataViewModel
  currentBox: new LiveData(null),         // CurrentBoxViewModel.boxName
  boxData: new LiveData(null),            // BoxDataViewModel
  filesList: new LiveData(null),          // FilesListViewModel
  openedFiles: new LiveData(null),        // OpenedFilesViewModel (the Kotlin instance's value)
  userEdited: new LiveData(false),        // EditedViewModel
  boxEdited: new LiveData(false),         // BoxEditedViewModel
  redirected: new LiveData(false),        // FileRedirectorViewModel
  usersSearch: new LiveData([]),
};
const clearState = (name) => {
  switch (name) {
    case 'names': vm.names.set([null, null]); break;
    case 'openedFiles': openedFiles('clear'); break;
    case 'userEdited': case 'boxEdited': case 'redirected': break;
    case 'usersSearch': vm.usersSearch.set([]); break;
    default: if (vm[name].value != null) vm[name].set(null);
  }
};

/** OpenedFilesViewModel.<op>() in Kotlin, then publish its new value. */
function openedFiles(op, a = '', b = '') {
  const list = JSON.parse(kt.openedFilesCall(op, String(a), String(b)));
  vm.openedFiles.set(list);
  return list;
}

// "signed.txt": the reversed uuid the app keeps in its private storage
let signedFile = null;

// ---------------------------------------------------------------- fragments --

class Fragment {
  constructor() { this.disposers = []; this.children = []; }
  onDispose(fn) { this.disposers.push(fn); }
  dispose() { this.children.forEach((c) => c.dispose()); this.disposers.forEach((f) => f()); this.disposers = []; }
  child(f) { this.children.push(f); f.parent = this; return f; }
}

/** FragmentTransaction.replace(container, fragment). */
function replace(owner, container, FragmentClass, ...args) {
  if (container._fragment) {
    container._fragment.dispose();
    owner.children = owner.children.filter((c) => c !== container._fragment);
  }
  const f = owner.child(new FragmentClass(...args));
  container.replaceChildren(f.root);
  container._fragment = f;
  f.created?.();
  return f;
}

const imgSrc = (logo) => (logo.startsWith('data:') ? logo : `data:image/jpeg;base64,${logo}`);
const setImage = (imageView, logo, fallback = '@drawable/default_user_logo') => {
  imageView._img.hidden = false;
  imageView._img.src = logo ? imgSrc(logo) : bitmap(fallback);
};
const setVisible = (el, visible) => el.classList.toggle('gone', !visible);
const isVisible = (el) => !el.classList.contains('gone');
const onInput = (edit, fn) => edit._input.addEventListener('input', () => fn(edit._input.value));
const setText = (edit, text) => { edit._input.value = text; edit._input.dispatchEvent(new Event('input')); };
const tint = (edit, c) => edit.style.setProperty('--tint', c);
const onClick = (el, fn) => el.addEventListener('click', (e) => { if (!el.disabled) fn(e); });

/** ListView + ArrayAdapter: one inflated item layout per entry, emptyView when there are none. */
function listAdapter(listView, layout, bind, emptyView = null) {
  const adapter = {
    items: [],
    notify() {
      listView.replaceChildren(...adapter.items.map((item, i) => { const row = view(layout); bind(row, item, i); return row; }));
      if (emptyView) { setVisible(emptyView, adapter.items.length === 0); setVisible(listView, adapter.items.length > 0); }
    },
  };
  return adapter;
}

/** SwipeRefreshLayout: pull down from the top to refresh. */
function swipeRefresh(layout, onRefresh) {
  const spinner = document.createElement('div');
  spinner.className = 'refresh-spinner';
  layout.prepend(spinner);
  let start = null, pulled = 0;
  layout.addEventListener('pointerdown', (e) => { if (layout.scrollTop <= 0 && !e.target.closest('input,textarea,select,button')) start = e.clientY; });
  layout.addEventListener('pointermove', (e) => {
    if (start == null) return;
    pulled = Math.max(0, Math.min(90, e.clientY - start));
    spinner.style.transform = `translate(-50%, ${pulled - 44}px) rotate(${pulled * 4}deg)`;
    spinner.style.opacity = String(pulled / 70);
  });
  const end = () => {
    if (start == null) return;
    start = null;
    if (pulled > 70) {
      spinner.classList.add('spinning');
      setTimeout(() => { onRefresh(); spinner.classList.remove('spinning'); spinner.style.opacity = '0'; spinner.style.transform = ''; }, 350);
    } else { spinner.style.opacity = '0'; spinner.style.transform = ''; }
    pulled = 0;
  };
  layout.addEventListener('pointerup', end);
  layout.addEventListener('pointerleave', end);
  layout.addEventListener('pointercancel', end);
}

/** TabLayout + ViewPager2 with lazily created pages (FragmentStateAdapter). */
function viewPager(owner, pagerEl, options, tabLayout = null, onPage = null) {
  const pages = options.map(() => null);
  const holders = options.map(() => { const d = document.createElement('div'); d.className = 'vp-page'; pagerEl.appendChild(d); return d; });
  const tabs = tabLayout ? options.map((o, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.className = 'tab';
    b.textContent = o.title;
    b.addEventListener('click', () => pager.setCurrent(i));
    tabLayout.appendChild(b);
    return b;
  }) : [];
  const pager = {
    current: -1,
    setCurrent(i) {
      if (!pages[i]) pages[i] = replace(owner, holders[i], options[i].page);
      holders.forEach((d, j) => d.classList.toggle('active', j === i));
      tabs.forEach((t, j) => t.setAttribute('aria-selected', String(j === i)));
      tabs[i]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const changed = pager.current !== i;
      pager.current = i;
      if (changed) onPage?.(i);
    },
    setTitle(i, t) { if (tabs[i]) tabs[i].textContent = t; },
    title: (i) => tabs[i]?.textContent,
    pages,
  };
  // ViewPager2 also pages with a horizontal swipe
  let sx = null, sy = null;
  pagerEl.addEventListener('pointerdown', (e) => { if (!e.target.closest('input,textarea,select,.color-wheel')) { sx = e.clientX; sy = e.clientY; } });
  pagerEl.addEventListener('pointerup', (e) => {
    if (sx == null) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    sx = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) pager.setCurrent(Math.max(0, Math.min(options.length - 1, pager.current + (dx < 0 ? 1 : -1))));
  });
  pager.setCurrent(0);
  return pager;
}

// ------------------------------------------------------------ dialogs/toasts --

let screen;

function toast(text, long = false) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = text;
  screen.appendChild(t);
  setTimeout(() => t.classList.add('out'), long ? 3200 : 1800);
  setTimeout(() => t.remove(), long ? 3600 : 2200);
}

/** AlertDialog.Builder(ctx, R.style.dialogTheme) with "cancel" and "ok". */
function alertDialog({ message, content = null, okText = 'ok', onOk, msgSize = 25, msgGap = 50, okEnabled = true }) {
  const style = res.styles.dialogTheme;
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const dlg = document.createElement('div');
  dlg.className = 'dialog';
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  applyBackground(dlg, style.windowBackground);
  dlg.style.color = color(style.textColor);
  const msg = document.createElement('div');
  msg.className = 'dialog-msg';
  msg.textContent = message;
  msg.style.fontSize = msgSize + 'px';
  msg.style.marginBottom = msgGap / 3 + 'px';
  dlg.appendChild(msg);
  if (content) dlg.appendChild(content);
  const row = document.createElement('div');
  row.className = 'dialog-buttons';
  const mk = (text) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    const bs = res.styles.buttonStyle;
    applyBackground(b, bs.background);
    b.style.color = color(bs.textColor);
    b.style.fontSize = dp(bs.textSize) + 'px';
    return b;
  };
  const cancel = mk('cancel'), ok = mk(okText);
  ok.disabled = !okEnabled;
  row.append(cancel, ok);
  dlg.appendChild(row);
  scrim.appendChild(dlg);
  screen.appendChild(scrim);
  const close = () => scrim.remove();
  cancel.addEventListener('click', close);
  scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) close(); });
  ok.addEventListener('click', () => { if (ok.disabled) return; close(); onOk(); });
  (content?.querySelector('input') || ok).focus();
  return { ok, close };
}

/** mv/settings/ConfirmDialog.kt */
const confirmDialog = (title, okClb) => alertDialog({ message: `¿ ${title} ؟`, onOk: okClb, msgGap: 150 });

/** mv/boxesDataManager/filesManipulator/dialogs/InputDialog.kt */
function inputDialog(title, okClb) {
  const layout = view('input_dialog');
  const input = find(layout, 'dialogInput'), warning = find(layout, 'inputDialogWarning');
  const dlg = alertDialog({ message: title, content: layout, onOk: () => okClb(input._input.value), okEnabled: true });
  onInput(input, (inputStr) => {
    const inputValid = /^[^#%?\s/]{1,40}$/;
    if (!inputValid.test(inputStr)) {
      dlg.ok.disabled = true;
      tint(input, APP.CRIMSON);
      warning.textContent = 'Invalid input (name can\'t include spaces, "?", "/", "#", "%", length should be 1-40 symbols)';
      return;
    }
    const files = vm.filesList.value.entries.dir.src;
    if (files.some((f) => f.name === inputStr)) {
      dlg.ok.disabled = true;
      tint(input, APP.CRIMSON);
      warning.textContent = 'An entry with the same name already exists in current directory';
      return;
    }
    warning.textContent = '';
    tint(input, APP.GREEN);
    dlg.ok.disabled = false;
  });
}

/** mv/inputPickers/ColorPicker.kt: skydoves ColorPickerView with a brightness slide bar. */
function colorPicker(btn, title, getDefault, okClb) {
  onClick(btn, () => {
    const wrap = document.createElement('div');
    wrap.className = 'picker';
    const wheel = document.createElement('canvas');
    wheel.className = 'color-wheel';
    wheel.width = wheel.height = 220;
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = '0'; slider.max = '100';
    slider.setAttribute('aria-label', 'Brightness');
    const flag = document.createElement('div');
    flag.className = 'picker-flag';
    wrap.append(wheel, flag, slider);
    const ctx = wheel.getContext('2d');
    const R = 110;
    const img = ctx.createImageData(220, 220);
    for (let y = 0; y < 220; y++) for (let x = 0; x < 220; x++) {
      const dx = x - R, dy = y - R, r = Math.hypot(dx, dy), i = (y * 220 + x) * 4;
      if (r > R) continue;
      const [cr, cg, cb] = hsv((Math.atan2(dy, dx) / Math.PI / 2 + 1) % 1, r / R, 1);
      img.data.set([cr, cg, cb, 255], i);
    }
    ctx.putImageData(img, 0, 0);
    let [hh, ss, vv] = rgbToHsv(getDefault());
    slider.value = String(Math.round(vv * 100));
    const current = () => { const [r, g, b] = hsv(hh, ss, vv); return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join(''); };
    const paint = () => {
      const c = current();
      flag.textContent = c.toUpperCase();
      flag.style.background = c;
      flag.style.color = vv > 0.6 ? '#000' : '#fff';
      slider.style.setProperty('--hue', hsvCss(hh, ss));
    };
    const pick = (e) => {
      const r = wheel.getBoundingClientRect();
      const x = (e.clientX - r.left) * (220 / r.width) - R, y = (e.clientY - r.top) * (220 / r.height) - R;
      hh = (Math.atan2(y, x) / Math.PI / 2 + 1) % 1;
      ss = Math.min(1, Math.hypot(x, y) / R);
      paint();
    };
    wheel.addEventListener('pointerdown', (e) => { wheel.setPointerCapture(e.pointerId); pick(e); });
    wheel.addEventListener('pointermove', (e) => { if (e.buttons) pick(e); });
    slider.addEventListener('input', () => { vv = Number(slider.value) / 100; paint(); });
    paint();
    const style = res.styles.colorPickerTheme;
    const d = alertDialog({ message: title, content: wrap, onOk: () => okClb(current()), msgSize: 20, msgGap: 20 });
    d.ok.closest('.dialog').style.color = color(style.textColor);
  });
}
function hsv(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return [r, g, b].map((x) => Math.round(x * 255));
}
const hsvCss = (h, s) => { const [r, g, b] = hsv(h, s, 1); return `rgb(${r},${g},${b})`; };
function rgbToHsv(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let hh = 0;
  if (d) hh = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((hh / 6) + 1) % 1, max ? d / max : 0, max];
}

/** ImageCropper: pick an image, crop it to a square and scale it to 350x350 (JPEG, base64). */
function pickImage(onPicked, square = true) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/jpg';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const side = Math.min(img.width, img.height);
      const [w, hgt] = square ? [350, 350] : [img.width, img.height];
      canvas.width = w; canvas.height = hgt;
      const g = canvas.getContext('2d');
      if (square) g.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 350, 350);
      else g.drawImage(img, 0, 0);
      onPicked(canvas.toDataURL('image/jpeg', 0.92).replace(/^data:image\/jpeg;base64,/, ''), file.name);
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });
  input.click();
}

/** A ShapeDrawable stroke in the picked colour (the colour buttons). */
const colorizeButton = (btn, c) => { btn.style.border = `3px solid ${c}`; btn.style.background = 'transparent'; btn.style.color = c; };

// ============================================================ MainActivity ==

const redirector = {};

class MainActivity extends Fragment {
  constructor() {
    super();
    this.root = view('activity_main');
    this.currentNavPosition = 0;
  }

  created() {
    const root = this.root;
    // ActivityHandler.fetchUsername
    this.fetchUsername();
    // setUpTitle(): "DichBox" in R.style.DynarShadowCFont
    const toolbar = find(root, 'mainTitleBar');
    toolbar._title.textContent = 'DichBox';
    const font = res.styles.DynarShadowCFont;
    toolbar._title.style.fontFamily = `"${font.fontFamily.replace('@font/', '')}"`;
    toolbar._title.style.fontSize = dp(font.textSize) + 'px';
    toolbar._title.style.color = color(toolbar._attrs['app:titleTextColor']);
    // the fragments' FrameLayout (fragment_container's inner #container)
    const containers = root.querySelectorAll('[data-id="container"]');
    this.container = containers[containers.length - 1];
    this.bottomNav = find(root, 'bottom_nav_view');
    this.buildBottomNav();
    this.navFragments = [User, BoxesList, Search, Settings].map((F) => {
      const holder = document.createElement('div');
      holder.className = 'nav-fragment';
      this.container.appendChild(holder);
      return replace(this, holder, F);
    });
    this.showFragment(0);
    this.homePageIcon = find(root, 'homePageIcon');
    this.homePageIcon.setAttribute('role', 'button');
    this.homePageIcon.setAttribute('aria-label', 'Home page');
    this.homePageIcon.tabIndex = 0;
    this.homePageIcon.addEventListener('click', () => this.goHome());
    this.homePageIcon.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.goHome(); });
    // setUserBtnColor()
    vm.names.observe(this, ([signed]) => applyBackground(this.homePageIcon, signed != null ? '@drawable/central_item_signed' : '@drawable/central_item_unsigned'));
    applyBackground(this.homePageIcon, vm.names.value[0] != null ? '@drawable/central_item_signed' : '@drawable/central_item_unsigned');
    Object.assign(redirector, {
      redirectSearched: () => this.redirectToUserPage(),
      redirectToBoxAdd: () => this.navFragments[1].setCurrentPosition(2),
      redirectToBoxInfo: () => this.navFragments[1].setCurrentPosition(1),
      redirectToBoxesList: () => this.navFragments[1].redirectToBoxesList(),
    });
  }

  requestUsername(uuid) {
    const [st, res] = api('getUsernameByUuid', { uuid });
    return st === 200 ? res.name : '';
  }

  fetchUsername() {
    if (!signedFile) return vm.names.set([null, null]);
    const name = this.requestUsername([...signedFile].reverse().join(''));
    if (name) {
      vm.names.set([name, name]);
      fillUserViewModel();
    } else {
      signedFile = null;
      vm.names.set([null, null]);
    }
  }

  buildBottomNav() {
    const menu = res.menus.bottom_menu;
    const items = [...menu.querySelectorAll('item')];
    const nav = this.bottomNav;
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'Bottom navigation');
    const size = dp(nav._attrs['app:itemIconSize']);
    this.navButtons = [];
    const optionsIds = ['userOption', 'boxesListOption', 'searchOption', 'settingsOption'];
    for (const item of items) {
      const id = item.getAttribute('android:id').replace('@+id/', '');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bn-item';
      const title = item.getAttribute('android:title');
      if (!title) { b.disabled = true; b.setAttribute('aria-hidden', 'true'); b.tabIndex = -1; } else {
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-label', title);
        b.title = title;
      }
      const icon = document.createElement('i');
      icon.style.width = icon.style.height = size + 'px';
      icon.style.maskImage = icon.style.webkitMaskImage = `url("${bitmap(item.getAttribute('android:icon'))}")`;
      b.appendChild(icon);
      if (title) b.addEventListener('click', () => this.handleListener(optionsIds.indexOf(id)));
      b.dataset.option = id;
      nav.appendChild(b);
      this.navButtons.push(b);
    }
    // app:itemIconTint="@drawable/bn_icon_active": a colour selector (checked / default)
    const sel = res.drawables.bn_icon_active.documentElement.querySelectorAll('item');
    nav.style.setProperty('--checked', color(sel[0].getAttribute('android:color')));
    nav.style.setProperty('--unchecked', color(sel[1].getAttribute('android:color')));
  }

  showFragment(position) {
    this.navFragments.forEach((f, i) => f.root.parentElement.classList.toggle('active', i === position));
    const optionsIds = ['userOption', 'boxesListOption', 'searchOption', 'settingsOption'];
    this.navButtons.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.option === optionsIds[position])));
  }

  handleListener(position) {
    if (position === -1) return false;
    this.currentNavPosition = position;
    this.showFragment(position);
    return true;
  }

  goHome() {
    const [signed, visited] = vm.names.value;
    if (signed !== visited) this.checkModifiedUsername();
    if (vm.names.value[0] == null) vm.names.set([null, null]);
    ['currentBox', 'boxData', 'filesList', 'openedFiles'].forEach(clearState);
    this.redirectToUserPage();
  }

  checkModifiedUsername() {
    if (!signedFile) return;
    const name = this.requestUsername([...signedFile].reverse().join(''));
    if (name) return vm.names.set([name, name]);
    signedFile = null;
    vm.names.set([null, null]);
  }

  redirectToUserPage() {
    if (this.currentNavPosition === 0) return;
    this.currentNavPosition = 0;
    this.showFragment(0);
  }
}

/** UserDataFetcher.fillUserViewModel */
function fillUserViewModel() {
  const [username, pathName] = vm.names.value;
  const [, data] = api('findUser', { username, pathName });
  vm.userData.set(data);
}

// ================================================================== User ==

class User extends Fragment {
  constructor() { super(); this.root = view('fragment_user'); }
  created() {
    const container = find(this.root, 'user_container');
    const pick = ([signed, visited]) => (signed !== visited ? VisitedUser : signed != null ? Profile : SignArea);
    replace(this, container, pick(vm.names.value));
    vm.names.observe(this, (names) => replace(this, container, pick(names)));
  }
}

class SignArea extends Fragment {
  constructor() { super(); this.root = view('fragment_sign'); }
  created() {
    const signIn = find(this.root, 'signIn'), signUp = find(this.root, 'signUp');
    const pagerEl = find(this.root, 'viewPager');
    const switchSignTitle = (position) => {
      const firstPos = position === 0;
      signUp.style.color = firstPos ? APP.BLACK : APP.BLUE;
      signIn.style.color = firstPos ? APP.BLUE : APP.BLACK;
      Object.assign(signUp.style, drawableCss(firstPos ? 'sign_active' : 'sign_inactive'));
      Object.assign(signIn.style, drawableCss(firstPos ? 'sign_inactive' : 'sign_active'));
    };
    let pager = null;
    pager = viewPager(this, pagerEl, [{ page: SignUp }, { page: SignIn }], null, (position) => {
      switchSignTitle(position);
      pager?.pages.forEach((p) => p?.cleanFieldsInput());
    });
    switchSignTitle(0);
    // on the phone the two forms are swiped; here the titles can be clicked as well
    [signUp, signIn].forEach((t, i) => {
      t.setAttribute('role', 'tab');
      t.tabIndex = 0;
      t.style.cursor = 'pointer';
      t.addEventListener('click', () => pager.setCurrent(i));
      t.addEventListener('keydown', (e) => { if (e.key === 'Enter') pager.setCurrent(i); });
    });
  }
}

/** FragmentCleaner.cleanInput */
function cleanInput(input) {
  if (input._input.value) { input._input.value = ''; }
  tint(input, APP.BLUE);
}

/** Wires an inflated EditText/Button to its Kotlin stand-in by handle. */
function bindToKotlin(...els) {
  for (const el of els) {
    if (el._input) el._input.addEventListener('input', () => kt.viewInput(h(el), el._input.value));
    else if (el.tagName === 'BUTTON') el.addEventListener('click', () => { if (!el.disabled) kt.viewClick(h(el)); });
  }
}

function saveSigned(name, uuid) {
  vm.names.set([name, name]);
  signedFile = [...uuid].reverse().join('');
}

class SignIn extends Fragment {
  constructor() { super(); this.root = view('sign_in'); }
  created() {
    const r = this.root;
    this.email = find(r, 'editEmailAddress');
    this.emailWarning = find(r, 'emailWarning');
    this.password = find(r, 'editPassword');
    this.passwordWarning = find(r, 'passwdWarning');
    const submit = find(r, 'submitSignIn');
    // SignInVerifier(submitBtn).checkEmail(email, emailWarning).checkPassword(password, passwordWarning)
    kt.signInForm(h(this.email), h(this.emailWarning), h(this.password), h(this.passwordWarning), h(submit));
    bindToKotlin(this.email, this.password, submit);
    submit.addEventListener('click', () => { onSigned = saveSigned; });
    onSigned = saveSigned;
  }
  cleanFieldsInput() {
    cleanInput(this.email); cleanInput(this.password);
    this.emailWarning.textContent = ''; this.passwordWarning.textContent = '';
  }
}

class SignUp extends Fragment {
  constructor() { super(); this.root = view('sign_up'); }
  created() {
    const r = this.root;
    this.username = find(r, 'editPersonName');
    this.nameWarning = find(r, 'usernameWarning');
    this.email = find(r, 'editEmailAddress');
    this.emailWarning = find(r, 'emailWarning');
    this.password = find(r, 'editPassword');
    this.passwordWarning = find(r, 'passwdWarning');
    const submit = find(r, 'submitSignUp');
    kt.signUpForm(h(this.username), h(this.nameWarning), h(this.email), h(this.emailWarning), h(this.password), h(this.passwordWarning), h(submit));
    bindToKotlin(this.username, this.email, this.password, submit);
    onSigned = saveSigned;
  }
  cleanFieldsInput() {
    [this.username, this.email, this.password].forEach(cleanInput);
    [this.nameWarning, this.emailWarning, this.passwordWarning].forEach((w) => { w.textContent = ''; });
  }
}

class Profile extends Fragment {
  constructor() { super(); this.root = view('fragment_user_profile'); }
  created() {
    const userData = vm.userData.value;
    if (userData == null || !userData.ownPage) fillUserViewModel();
    const label = (n) => {
      if (n === 0) return 'notifications';
      const s = String(n);
      return `notifications (${s.length < 4 ? s : s.slice(0, 4) + '...'})`;
    };
    const notificationsLabel = userData == null ? 'notifications' : label(vm.userData.value.notifications);
    const tabLayout = find(this.root, 'tabLayout');
    const pager = viewPager(this, find(this.root, 'user_viewPager'), [
      { title: 'profile', page: ProfileInfo },
      { title: 'edit', page: ProfileEditor },
      { title: 'subscriptions', page: Subscriptions },
      { title: notificationsLabel, page: Notifications },
    ], tabLayout);
    vm.userEdited.observe(this, () => pager.setCurrent(0));
    vm.userData.observe(this, (it) => {
      if (it == null || !it.ownPage) return;
      const old = pager.title(3);
      if (it.notifications === 0 && old === 'notifications') return;
      const nl = label(it.notifications);
      if (nl !== old) pager.setTitle(3, nl);
    });
  }
}

/** UserProfiler.fill* through tools/ViewDecorators.kt (Kotlin). */
function fillProfile(r, data, withEmail) {
  const username = find(r, 'userName'), description = find(r, 'userDescription');
  kt.fill(h(username), data.name, data.name_color);
  if (!data.description) setVisible(description, false);
  else { setVisible(description, true); kt.fill(h(description), data.description, data.description_color); }
  const email = find(r, 'userEmailText');
  if (withEmail && email) {
    if (data.email == null) setVisible(email, false);
    else { setVisible(email, true); kt.decorate(h(email), 'email: ', data.email, 'PURPLE'); }
  }
  kt.decorate(h(find(r, 'userSignedDate')), 'signed: ', data.reg_date, 'GREEN');
  kt.decorate(h(find(r, 'userFollowers')), 'followers: ', String(data.followers), 'GRAY');
  setImage(find(r, 'userLogo'), data.logo);
}

class ProfileInfo extends Fragment {
  constructor() { super(); this.root = view('fragment_profile'); }
  created() {
    let userData = vm.userData.value;
    const fields = () => fillProfile(this.root, userData, true);
    fields();
    vm.userData.observe(this, (it) => { if (it == null || !it.ownPage) return; userData = it; fields(); });
    swipeRefresh(find(this.root, 'refreshUserInfo'), () => {
      // UserProfiler.refetchData
      if (!signedFile) return;
      const [st1, res1] = api('getUsernameByUuid', { uuid: [...signedFile].reverse().join('') });
      if (st1 !== 200) return;
      vm.names.set([res1.name, res1.name]);
      const [first, second] = vm.names.value;
      const [st2, data] = api('findUser', { username: first, pathName: second });
      if (st2 !== 200) return;
      vm.userData.set(data);
    });
  }
}

class ProfileEditor extends Fragment {
  constructor() { super(); this.root = view('fragment_user_editor'); }
  created() { this.render(); }
  render() {
    const r = this.root;
    const defaultData = vm.userData.value;
    const submitter = find(r, 'editProfileBtn');
    submitter.disabled = true;
    const edited = { name: defaultData.name, name_color: defaultData.name_color, description: defaultData.description,
      description_color: defaultData.description_color, email: defaultData.email };
    kt.profileVerifierInit(defaultData.name, defaultData.email);
    // UserLogoEditor
    const logoView = find(r, 'editUserLogo');
    const [changeBtn, setDefaultBtn, cancelBtn] = ['changeUserLogoBtn', 'setDefaultUserLogoBtn', 'cancelUserLogoBtn'].map((id) => find(r, id));
    const initialLogo = defaultData.logo;
    let logo = initialLogo;
    const setLogoView = () => setImage(logoView, logo === 'removed' ? null : logo);
    const setCancelVisibility = () => setVisible(cancelBtn, logo !== initialLogo);
    setVisible(cancelBtn, false);
    if (initialLogo == null) setVisible(setDefaultBtn, false);
    setLogoView();
    // PasswordsVerifier
    const passwdArea = find(r, 'editUserPasswdArea'), showAreaBtn = find(r, 'changePasswdBtn'), hideAreaBtn = find(r, 'cancelChangePasswdBtn');
    const passwd = find(r, 'editUserPasswd'), newPasswd = find(r, 'editUserNewPasswd');
    const passwdWarn = find(r, 'editUserPasswdWarning'), newPasswdWarn = find(r, 'editUserNewPasswdWarning');
    kt.passwdVerifierInit(defaultData.name);
    const pw = { passwdStr: '', newPasswdStr: '', isCorrect: false, passwdCorrect: false, newPasswdCorrect: false };
    setVisible(passwdArea, false);
    setVisible(showAreaBtn, true);
    const decorateFields = (warnMessage, input, warning, checkArea = false) => {
      if (checkArea && !isVisible(passwdArea)) { tint(input, APP.BLUE); return; }
      warning.textContent = warnMessage;
      tint(input, warnMessage ? APP.CRIMSON : APP.GREEN);
    };
    const checkAllAdded = () => {
      const textChanged = defaultData.name !== edited.name || defaultData.description !== edited.description || defaultData.email !== edited.email;
      const colorsChanged = defaultData.name_color !== edited.name_color || defaultData.description_color !== edited.description_color;
      // same expression (and operator precedence) as UserEditorVerifier.checkAllAdded
      const isValid = (kt.profileCheckAll() && textChanged) || colorsChanged || pw.isCorrect || logo !== initialLogo;
      submitter.disabled = !isValid;
      submitter.style.color = isValid ? APP.GREEN : APP.BLUE;
      Object.assign(submitter.style, drawableCss(isValid ? 'sign_submit_btn_active' : 'sign_submit_btn_inactive'));
    };
    onInput(passwd, (inputText) => {
      if (pw.passwdStr === inputText) return;
      const { warning } = JSON.parse(kt.passwdVerify('PASSWD', inputText));
      pw.passwdStr = inputText;
      decorateFields(warning, passwd, passwdWarn, true);
      newPasswd._input.disabled = !!warning;
      pw.passwdCorrect = !warning;
      pw.isCorrect = pw.newPasswdCorrect && pw.passwdCorrect;
      checkAllAdded();
    });
    onInput(newPasswd, (inputText) => {
      if (pw.newPasswdStr === inputText) return;
      const { warning, checkAll } = JSON.parse(kt.passwdVerify('NEW_PASSWD', inputText));
      pw.newPasswdStr = inputText;
      decorateFields(warning, newPasswd, newPasswdWarn, true);
      pw.newPasswdCorrect = checkAll;
      pw.isCorrect = pw.newPasswdCorrect && pw.passwdCorrect;
      checkAllAdded();
    });
    onClick(hideAreaBtn, () => {
      setVisible(passwdArea, false);
      setText(passwd, ''); setText(newPasswd, '');
      newPasswd._input.disabled = true;
      Object.assign(pw, { isCorrect: false, passwdCorrect: false, newPasswdCorrect: false, passwdStr: '', newPasswdStr: '' });
      passwdWarn.textContent = ''; newPasswdWarn.textContent = '';
      setVisible(showAreaBtn, true);
      checkAllAdded();
    });
    onClick(showAreaBtn, () => { setVisible(showAreaBtn, false); setVisible(passwdArea, true); });
    // name / description / email (UserEditorVerifier.add*Check)
    const name = find(r, 'editUsername'), nameWarning = find(r, 'editUserNameWarning');
    const description = find(r, 'editDescription'), email = find(r, 'editEmail'), emailWarning = find(r, 'editUserEmailWarning');
    const nameColorBtn = find(r, 'editUsernameColor'), descriptionColorBtn = find(r, 'editDescriptionColor');
    colorizeButton(nameColorBtn, edited.name_color);
    name._input.value = edited.name;
    name._input.style.color = edited.name_color;
    colorizeButton(descriptionColorBtn, edited.description_color);
    description._input.value = edited.description;
    description._input.style.color = edited.description_color;
    email._input.value = edited.email;
    onInput(name, (inputText) => {
      if (edited.name === inputText) return;
      const warning = kt.profileVerify('NAME', inputText);
      edited.name = inputText;
      decorateFields(warning, name, nameWarning);
      checkAllAdded();
    });
    onInput(description, (inputText) => {
      if (edited.description === inputText) return;
      kt.profileVerify('DESCRIPTION', inputText);
      edited.description = inputText;
      checkAllAdded();
    });
    onInput(email, (inputText) => {
      if (edited.email === inputText) return;
      const warning = kt.profileVerify('EMAIL', inputText);
      edited.email = inputText;
      decorateFields(warning, email, emailWarning);
      checkAllAdded();
    });
    colorPicker(nameColorBtn, 'Username color', () => edited.name_color, (c) => {
      name._input.style.color = c; edited.name_color = c; colorizeButton(nameColorBtn, c); checkAllAdded();
    });
    colorPicker(descriptionColorBtn, 'Description color', () => edited.description_color, (c) => {
      description._input.style.color = c; edited.description_color = c; colorizeButton(descriptionColorBtn, c); checkAllAdded();
    });
    // logo buttons (UserLogoEditor + ImageCropper)
    onClick(changeBtn, () => pickImage((src) => {
      logo = src;
      setVisible(setDefaultBtn, initialLogo != null);
      setCancelVisibility(); setLogoView(); checkAllAdded();
    }));
    onClick(cancelBtn, () => { logo = initialLogo; setVisible(setDefaultBtn, initialLogo != null); setCancelVisibility(); setLogoView(); checkAllAdded(); });
    onClick(setDefaultBtn, () => { logo = 'removed'; setVisible(setDefaultBtn, false); setCancelVisibility(); setLogoView(); checkAllAdded(); });
    checkAllAdded();
    // UserEditorVerifier.addSubmitAction
    onClick(submitter, () => {
      const checkIfEdited = (def, ed) => (def === ed ? null : ed);
      const container = {
        username: defaultData.name,
        logo: logo !== initialLogo ? logo : null,
        edited: {
          name: checkIfEdited(defaultData.name, edited.name),
          description: checkIfEdited(defaultData.description, edited.description),
          email: checkIfEdited(defaultData.email, edited.email),
          name_color: checkIfEdited(defaultData.name_color, edited.name_color),
          description_color: checkIfEdited(defaultData.description_color, edited.description_color),
          passwd: pw.isCorrect ? pw.newPasswdStr : null,
        },
      };
      const [st] = api('editUser', container);
      if (st !== 200) return;
      // ProfileEditor.setSubmitClb
      const ef = container.edited;
      const userData = vm.userData.value;
      const editedData = { ...userData,
        name: ef.name ?? userData.name, description: ef.description ?? userData.description,
        name_color: ef.name_color ?? userData.name_color, description_color: ef.description_color ?? userData.description_color,
        email: ef.email ?? userData.email, logo: logo === 'removed' ? null : logo };
      toast('Edited', true);
      vm.userData.set(editedData);
      if (ef.name != null) {
        const oldName = defaultData.name;
        vm.names.set([ef.name, ef.name]);
        const boxData = vm.boxData.value;
        if (boxData != null) vm.boxData.set({ ...boxData, owner_name: ef.name });
        if (vm.openedFiles.value != null) openedFiles('renamePaths', `/${oldName}`, `/${ef.name}`);
      }
      vm.userEdited.set(true);
    });
    // detach/attach on new user data
    const userDataNow = vm.userData.value;
    const off = () => {};
    vm.userData.observe(this, (it) => {
      if (it == null || same(it, userDataNow) || !it.ownPage) return;
      this.dispose();
      this.root.replaceWith(this.root = (() => { const n = view('fragment_user_editor'); return n; })());
      this.render();
    });
    off();
  }
}

/** found_user rows: logo, coloured name, and the remove icon (Subscriptions / access lists). */
function bindFoundUser(row, user, { removable = false, onClickRow = null, onClickName = null, onRemove = null, removeIcon = null }) {
  const logo = find(row, 'subscription_logo'), name = find(row, 'subscription_name'), rm = find(row, 'removeSubscription');
  setImage(logo, user.logo);
  name.textContent = user.name;
  name.style.color = user.name_color;
  setVisible(rm, removable);
  if (removeIcon) rm._img.src = bitmap(removeIcon);
  if (onRemove) { rm.setAttribute('role', 'button'); rm.setAttribute('aria-label', 'Remove ' + user.name); rm.addEventListener('click', onRemove); }
  if (onClickRow) { row.classList.add('clickable'); row.addEventListener('click', onClickRow); }
  if (onClickName) { [name, logo].forEach((v) => { v.classList.add('clickable'); v.addEventListener('click', onClickName); }); }
}

class Subscriptions extends Fragment {
  constructor() { super(); this.root = view('fragment_user_subscriptions'); }
  created() {
    const r = this.root;
    const username = vm.userData.value.name;
    const listView = find(r, 'subscriptionsList'), search = find(r, 'subscriptionsSearch');
    let items = [];
    const adapter = listAdapter(listView, 'found_user', (row, sub) => bindFoundUser(row, sub, {
      removable: true,
      onClickName: () => { const n = vm.names.value; vm.names.set([n[0], sub.name]); },
      onRemove: () => {
        const [st, res] = api('subscribeAction', { action: 'unsubscribe', personName: username, subscriptionName: sub.name });
        if (!(st === 200 && res.unsubscribed)) return;
        items = items.filter((i) => i.name !== sub.name);
        adapter.items = adapter.items.filter((i) => i.name !== sub.name);
        adapter.notify();
      },
    }), find(r, 'emptySubs'));
    const getSubs = () => { const [st, res] = api('getSubscriptions', { name: username }); return st === 200 ? res.subs : []; };
    const filter = () => { adapter.items = items.filter((i) => i.name.includes(search._input.value)); adapter.notify(); };
    items = getSubs();
    adapter.items = [...items];
    adapter.notify();
    onInput(search, filter);
    const refreshSubs = () => { items = getSubs(); adapter.items = [...items]; adapter.notify(); search._input.value = ''; };
    let userData = vm.userData.value;
    swipeRefresh(find(r, 'refreshSubscriptions'), () => { refreshSubs(); userData = vm.userData.value; });
    vm.userData.observe(this, (it) => { if (it == null || same(it, userData)) return; refreshSubs(); userData = it; });
  }
}

class Notifications extends Fragment {
  constructor() { super(); this.root = view('fragment_user_notifications'); }
  created() {
    const r = this.root;
    const username = vm.userData.value.name;
    const cleanBtn = find(r, 'cleanNotificationsList'), listView = find(r, 'notificationsList');
    const adapter = listAdapter(listView, 'notification', (row, n) => {
      setImage(find(row, 'notification_logo'), n.icon);
      find(row, 'notification_date').textContent = n.note_date;
      // NotificationsTypes.defineType(type).decorateView(notification, msg) in Kotlin
      renderSpans(find(row, 'notification_msg'), JSON.parse(kt.notificationMessage(JSON.stringify(n))));
      const rm = find(row, 'notificationsRmIcon');
      rm.setAttribute('role', 'button');
      rm.setAttribute('aria-label', 'Remove notification');
      rm.addEventListener('click', () => removeNotifications([n.id]));
    }, find(r, 'ntsEmpty'));
    const getNotifications = () => api('getNotifications', { name: username })[1].notifications;
    const refreshAmount = (size) => vm.userData.set({ ...vm.userData.value, notifications: size });
    const onEmptyListCheck = () => setVisible(cleanBtn, adapter.items.length > 0);
    const removeNotifications = (ids) => {
      const [st, res] = api('removeNotifications', { username, ntsIds: ids });
      if (!(res.removed && st === 200)) return;
      adapter.items = adapter.items.filter((n) => !ids.includes(n.id));
      adapter.notify();
      refreshAmount(adapter.items.length);
      onEmptyListCheck();
    };
    const refresh = () => { adapter.items = getNotifications(); refreshAmount(adapter.items.length); adapter.notify(); onEmptyListCheck(); };
    onClick(cleanBtn, () => removeNotifications(adapter.items.map((n) => n.id)));
    adapter.items = getNotifications();
    adapter.notify();
    onEmptyListCheck();
    let userData = vm.userData.value;
    swipeRefresh(find(r, 'refreshNotifications'), () => { refresh(); userData = vm.userData.value; });
    vm.userData.observe(this, (it) => { if (it == null || same(it, userData)) return; refresh(); userData = it; });
  }
}

class VisitedUser extends Fragment {
  constructor() { super(); this.root = view('fragment_user_visited'); }
  created() {
    const r = this.root;
    fillUserViewModel();
    const subscribeButton = find(r, 'userSubscription');
    subscribeButton.setAttribute('role', 'button');
    subscribeButton.tabIndex = 0;
    const decorateSubscriptionView = (follower) => {
      const isSigned = vm.names.value[0] != null;
      setVisible(subscribeButton, isSigned);
      subscribeButton.textContent = follower && isSigned ? 'unsubscribe' : 'subscribe';
      subscribeButton.style.color = follower && isSigned ? APP.PURPLE : APP.GREEN;
    };
    const fields = () => { decorateSubscriptionView(vm.userData.value.follower); fillProfile(r, vm.userData.value, false); };
    subscribeButton.addEventListener('click', () => {
      const [personName, subscriptionName] = vm.names.value;
      const [st, data] = api('subscribeAction', { action: subscribeButton.textContent, personName, subscriptionName, responseValues: true });
      if (st !== 200) return;
      kt.decorate(h(find(r, 'userFollowers')), 'followers: ', String(data.followers), 'GRAY');
      decorateSubscriptionView(data.follower);
      vm.userData.set({ ...vm.userData.value, followers: data.followers, follower: data.follower });
    });
    fields();
    swipeRefresh(find(r, 'refreshVisited'), () => {
      const [username, pathName] = vm.names.value;
      const [, data] = api('findUser', { username, pathName });
      if (data.name !== pathName) return;
      vm.userData.set(data);
      fields();
    });
  }
}

// ================================================================ Search ==

class Search extends Fragment {
  constructor() { super(); this.root = view('fragment_search'); }
  created() {
    const r = this.root;
    const searchMsg = find(r, 'userSearchPrompt'), inputField = find(r, 'userSearch'), usersList = find(r, 'usersList');
    const adapter = listAdapter(usersList, 'found_user', (row, user) => bindFoundUser(row, user, {
      onClickRow: () => {
        // visitUserPage + redirectionCleanup
        vm.names.set([vm.names.value[0], user.name]);
        redirector.redirectSearched();
        ['currentBox', 'boxData', 'filesList', 'openedFiles'].forEach(clearState);
        vm.usersSearch.set([]);
        setText(inputField, '');
      },
    }), searchMsg);
    adapter.notify();
    onInput(inputField, (chunk) => {
      const users = chunk ? api('search', { searchStr: chunk })[1].searched : [];
      if (!users.length) searchMsg.textContent = chunk ? 'No users were found' : 'Search here for users';
      adapter.items = users;
      adapter.notify();
    });
  }
}

// ============================================================== Settings ==

class Settings extends Fragment {
  constructor() { super(); this.root = view('fragment_settings'); }
  created() {
    const r = this.root;
    const signOutBtn = find(r, 'signOut'), rmAccountBtn = find(r, 'removeUserAccount');
    [signOutBtn, rmAccountBtn].forEach((b) => { b.setAttribute('role', 'button'); b.tabIndex = 0; });
    const viewStates = ['names', 'currentBox', 'boxData', 'filesList', 'openedFiles', 'usersSearch', 'userData'];
    const signOut = () => {
      if (!signedFile) return;
      viewStates.forEach(clearState);
      signedFile = null;
    };
    signOutBtn.addEventListener('click', () => confirmDialog('Sign out', signOut));
    rmAccountBtn.addEventListener('click', () => confirmDialog('Remove this account', () => {
      const uuid = [...signedFile].reverse().join('');
      const [st, res] = api('removeUser', { uuid, confirmation: 'permitted' });
      if (st === 200 && res.removed) signOut();
    }));
    const settingsArea = find(r, 'settingsOptions'), notSignedText = find(r, 'settingsNotSigned');
    const show = (signed) => { setVisible(settingsArea, signed); setVisible(notSignedText, !signed); };
    show(!!signedFile);
    vm.names.observe(this, ([signed]) => show(signed != null));
  }
}

// ============================================================= BoxesList ==

class BoxesList extends Fragment {
  constructor() { super(); this.root = view('fragment_boxes'); this.currentPosition = 0; }
  created() {
    this.container = find(this.root, 'boxesContainer');
    const boxesShown = vm.names.value[1] != null;
    this.currentPosition = boxesShown ? 1 : 0;
    replace(this, this.container, boxesShown ? BoxesInfo : BoxesNone);
    vm.names.observe(this, ([signed, visited]) => {
      const ownPage = signed != null && signed === visited;
      const atBoxPage = this.currentPosition === 2;
      const boxOpened = vm.currentBox.value != null;
      if ((ownPage && atBoxPage) || boxOpened) return;
      const shown = visited != null;
      this.currentPosition = shown ? 1 : 0;
      replace(this, this.container, shown ? BoxesInfo : BoxesNone);
    });
    vm.currentBox.observe(this, (it) => {
      const [signed, visited] = vm.names.value;
      const ownPage = signed != null && signed === visited;
      if (it != null) { this.currentPosition = 3; return; }
      if (ownPage && this.currentPosition === 2) return;
      const shown = vm.names.value[1] != null;
      this.currentPosition = shown ? 1 : 0;
      replace(this, this.container, shown ? BoxesInfo : BoxesNone);
    });
  }
  setCurrentPosition(p) { this.currentPosition = p; }
  redirectToBoxesList() { this.setCurrentPosition(1); replace(this, this.container, BoxesInfo); }
}

class BoxesNone extends Fragment {
  constructor() { super(); this.root = view('boxes_none'); }
}

class BoxesInfo extends Fragment {
  constructor() { super(); this.root = view('fragment_boxes_list'); }
  created() {
    const r = this.root;
    const namesState = vm.names.value;
    const listView = find(r, 'boxesList'), boxesSearch = find(r, 'boxesSearch'), typesSpinner = find(r, 'boxesSearchSpinner');
    const addBoxBtn = find(r, 'addBoxIcon');
    const userData = vm.userData.value;
    const ownPage = namesState[0] == null ? false : userData == null ? true : userData.ownPage;
    setVisible(addBoxBtn, ownPage);
    let nameArgs = [namesState[0], namesState[1]];
    // BoxesListPresenter
    const getBoxes = ([viewerName, boxOwnerName]) => {
      const [st, res] = api('getUserBoxes', { viewerName, boxOwnerName });
      return st === 200 ? res.boxesList : [];
    };
    let boxes = getBoxes(nameArgs);
    const adapter = listAdapter(listView, 'boxes_list_item', (row, box) => {
      const item = find(row, 'boxesListItem');
      const viewText = `${box.name} (${box.access_level})`;
      item.textContent = '';
      const n = document.createElement('span');
      n.textContent = box.name;
      n.style.color = box.name_color;
      const t = document.createElement('span');
      t.textContent = viewText.slice(box.name.length);
      t.style.fontStyle = 'italic';
      t.style.fontSize = '0.9em';
      item.append(n, t);
      row.classList.add('clickable');
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      const open = () => {
        const oldNames = vm.names.value;
        if (oldNames[0] !== box.owner_name) vm.names.set([oldNames[0], box.owner_name]);
        vm.currentBox.set(box.name);
        replace(this.parent, this.parent.container, BoxEntries);
      };
      row.addEventListener('click', open);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    }, find(r, 'boxesListEmpty'));
    adapter.items = [...boxes];
    adapter.notify();
    const getBoxesType = (own) => (own ? ['all', 'public', 'private', 'followers', 'limited', 'invetee'] : ['all', 'public', 'followers', 'limited']);
    const select = typesSpinner._select;
    const fillTypes = (own) => { select.replaceChildren(...getBoxesType(own).map((t) => { const o = document.createElement('option'); o.textContent = t; return o; })); };
    fillTypes(ownPage);
    const filterBoxesByType = () => {
      const [nameChunk, boxType] = [boxesSearch._input.value, select.value];
      adapter.items = boxes.filter((b) => b.name.includes(nameChunk) && (boxType === 'all' || b.access_level === boxType));
      adapter.notify();
    };
    onInput(boxesSearch, filterBoxesByType);
    select.addEventListener('change', filterBoxesByType);
    onClick(addBoxBtn, () => { replace(this.parent, this.parent.container, AddBox); redirector.redirectToBoxAdd(); });
    const refreshData = (own) => {
      adapter.items = boxes;
      boxesSearch._input.value = '';
      fillTypes(own);
      adapter.notify();
    };
    vm.userData.observe(this, (it) => {
      if (it == null || it.name === nameArgs[1]) return;
      nameArgs = [nameArgs[0], it.name];
      setVisible(addBoxBtn, it.ownPage);
      boxes = getBoxes(nameArgs);
      refreshData(it.ownPage);
    });
    swipeRefresh(find(r, 'refreshBoxesList'), () => { boxes = getBoxes(nameArgs); refreshData(vm.userData.value.ownPage); });
  }
}

/** box_form shared by AddBox and BoxEditor: AccessList, BoxPrivacyHandler, BoxLogoEditor. */
function accessList(containerView, defaultAdded, username, onModified) {
  const searchInput = find(containerView, 'namesSearch'), clearBtn = find(containerView, 'namesCleanBtn');
  const foundView = find(containerView, 'foundUsers'), addedView = find(containerView, 'addedUsers');
  const added = listAdapter(addedView, 'found_user', (row, user) => bindFoundUser(row, user, {
    removable: true, removeIcon: '@drawable/trash_bin_round',
    onRemove: () => { added.items = added.items.filter((u) => u.name !== user.name); added.notify(); onModified?.(); },
  }), find(containerView, 'addedUsersEmpty'));
  const found = listAdapter(foundView, 'found_user', (row, user) => bindFoundUser(row, user, {
    onClickRow: () => {
      if (!added.items.some((u) => u.name === user.name)) { added.items.push(user); added.notify(); setText(searchInput, ''); }
      onModified?.();
    },
  }));
  added.items = [...defaultAdded];
  added.notify();
  if (!added.items.length) setVisible(foundView, false);
  onInput(searchInput, (input) => {
    if (!input) { found.items = []; setVisible(foundView, false); } else {
      const [, res] = api('getUsernames', { username, nameTemplate: input });
      found.items = res.foundUsers;
      setVisible(foundView, found.items.length > 0);
    }
    found.notify();
  });
  onClick(clearBtn, () => setText(searchInput, ''));
  return { getAddedUsers: () => [...added.items] };
}

function boxPrivacy(privacyView, initialPrivacy, initialLimited, username, onModified, pickClb) {
  const limitedListView = find(privacyView, 'limitedContainer');
  const limited = accessList(limitedListView, initialLimited, username, onModified);
  let privacy = initialPrivacy;
  setVisible(limitedListView, privacy === 'limited');
  const radios = ['radioPublic', 'radioPrivate', 'radioFollowers', 'radioLimited'].map((id) => find(privacyView, id));
  const group = 'privacy' + Math.random().toString(36).slice(2);
  radios.forEach((radio) => {
    radio._input.name = group;
    const text = radio.textContent;
    if (text.startsWith(privacy)) radio._input.checked = true;
    radio._input.addEventListener('change', () => {
      privacy = text.split(' ')[0];
      setVisible(limitedListView, privacy === 'limited');
      pickClb?.();
    });
  });
  return { getPrivacy: () => [privacy, limited.getAddedUsers()] };
}

function boxLogoEditor(r, initialLogo, checkAllClb) {
  const logoContainer = find(r, 'editBoxLogo');
  const [changeBtn, removeBtn, cancelBtn] = ['changeBoxLogoBtn', 'removeBoxLogoBtn', 'cancelBoxLogoBtn'].map((id) => find(r, id));
  let logo = initialLogo;
  setVisible(cancelBtn, false);
  if (initialLogo == null) { setVisible(removeBtn, false); setVisible(logoContainer, false); } else setImage(logoContainer, initialLogo);
  const setButtonsState = () => { const changed = logo !== initialLogo; setVisible(cancelBtn, changed); changeBtn.textContent = changed ? 'change logo' : '*set logo'; };
  const setLogoView = () => { const empty = logo == null || logo === 'removed'; setVisible(logoContainer, !empty); if (!empty) setImage(logoContainer, logo); };
  onClick(changeBtn, () => pickImage((src) => { logo = src; setVisible(removeBtn, initialLogo != null); setButtonsState(); setLogoView(); checkAllClb(); }));
  onClick(cancelBtn, () => { logo = initialLogo; setVisible(removeBtn, initialLogo != null); setButtonsState(); setLogoView(); checkAllClb(); });
  onClick(removeBtn, () => { logo = 'removed'; setVisible(removeBtn, false); setButtonsState(); setLogoView(); checkAllClb(); });
  return { getLogo: () => [logo, logo !== initialLogo] };
}

function decorateSubmitter(submitter, valid) {
  submitter.disabled = !valid;
  const c = valid ? APP.GREEN : APP.BLUE;
  submitter.style.border = `3px solid ${c}`;
  submitter.style.background = 'transparent';
  submitter.style.color = c;
}

class AddBox extends Fragment {
  constructor() { super(); this.root = view('fragment_box_add'); }
  created() {
    const r = this.root;
    const username = vm.names.value[0];
    const addBoxBtn = find(r, 'createBtn'), cancelBtn = find(r, 'cancelBtn');
    const defaultColor = '#00d9ff';
    let nameColor = defaultColor, descriptionColor = defaultColor, nameCorrect = false;
    const logoEditor = boxLogoEditor(r, null, () => {});
    const editors = accessList(find(r, 'editorsContainer'), [], username);
    const privacy = boxPrivacy(find(r, 'boxPrivacy'), 'public', [], username);
    const nameInput = find(r, 'boxNameInput'), nameWarning = find(r, 'boxNameWarning'), descriptionInput = find(r, 'editDescription');
    nameInput._input.style.color = nameColor;
    descriptionInput._input.style.color = descriptionColor;
    addBoxBtn.disabled = true;
    // BoxFormGenerator.verifyNameInput: the checks run in Kotlin
    onInput(nameInput, (input) => {
      const { warning, correct } = JSON.parse(kt.boxNameCheck(username, input));
      nameCorrect = correct;
      if (!input) { tint(nameInput, APP.BLUE); nameWarning.textContent = ''; } else {
        nameWarning.textContent = warning;
        tint(nameInput, warning ? APP.CRIMSON : APP.GREEN);
      }
      decorateSubmitter(addBoxBtn, nameCorrect);
    });
    onClick(addBoxBtn, () => {
      const editorsList = editors.getAddedUsers();
      const [access, limitedList] = privacy.getPrivacy();
      const body = {
        username,
        logo: logoEditor.getLogo()[0],
        editors: editorsList.length ? editorsList.map((u) => u.name) : null,
        limitedUsers: limitedList.length ? limitedList.map((u) => u.name) : null,
        boxData: {
          name: nameInput._input.value,
          name_color: nameColor === defaultColor ? null : nameColor,
          description: descriptionInput._input.value,
          description_color: descriptionColor === defaultColor ? null : descriptionColor,
          access_level: access,
        },
      };
      const [st, res] = api('createBox', body);
      if (st !== 201) return;
      vm.currentBox.set(res.name);
      replace(this.parent, this.parent.container, BoxEntries);
    });
    colorPicker(find(r, 'setBoxNameColor'), 'Box name color', () => nameColor, (c) => {
      colorizeButton(find(r, 'setBoxNameColor'), c); nameInput._input.style.color = c; nameColor = c;
    });
    colorPicker(find(r, 'editDescriptionColor'), 'Description color', () => descriptionColor, (c) => {
      colorizeButton(find(r, 'editDescriptionColor'), c); descriptionInput._input.style.color = c; descriptionColor = c;
    });
    onClick(cancelBtn, () => { replace(this.parent, this.parent.container, BoxesInfo); redirector.redirectToBoxInfo(); });
  }
}

// ============================================================= BoxEntries ==

class BoxEntries extends Fragment {
  constructor() { super(); this.root = view('fragment_box'); }
  created() {
    const [signed, visited] = vm.names.value;
    const ownPage = signed === visited;
    const all = [
      { title: 'info', page: BoxInfo },
      { title: 'edit', page: BoxEditor },
      { title: 'files', page: BoxFiles },
      { title: 'opened files', page: OpenedContainer },
    ];
    const tabOptions = ownPage ? all : all.filter((_, i) => i !== 1);
    const pager = viewPager(this, find(this.root, 'boxViewPager'), tabOptions, find(this.root, 'boxTabLayout'));
    vm.boxEdited.observe(this, (it) => { if (!it) return; pager.setCurrent(0); vm.boxEdited.set(false); });
    vm.redirected.observe(this, (it) => { if (!it) return; pager.setCurrent(tabOptions.length - 1); vm.redirected.set(false); });
  }
}

/** BoxProfiler.fetchBoxData */
function fetchBoxData(boxName) {
  const [viewerName, ownerName] = vm.names.value;
  const [st, data] = api('getBoxDetails', { ownerName, viewerName, boxName });
  if (st === 200) vm.boxData.set(data);
  return data;
}

class BoxInfo extends Fragment {
  constructor() { super(); this.root = view('fragment_box_info'); }
  created() {
    const r = this.root;
    let boxDetails = vm.boxData.value ?? fetchBoxData(vm.currentBox.value);
    const fields = () => {
      const logoView = find(r, 'boxLogo');
      setVisible(logoView, boxDetails.logo != null);
      if (boxDetails.logo) setImage(logoView, boxDetails.logo);
      kt.fill(h(find(r, 'boxName')), boxDetails.name, boxDetails.name_color);
      const desc = find(r, 'boxDescription');
      if (!boxDetails.description) setVisible(desc, false);
      else { setVisible(desc, true); kt.fill(h(desc), boxDetails.description, boxDetails.description_color); }
      kt.decorate(h(find(r, 'boxCreator')), 'Creator: ', boxDetails.owner_name, boxDetails.owner_nc);
      kt.decorate(h(find(r, 'boxType')), 'Type: ', boxDetails.access_level, 'ORANGE');
      kt.decorate(h(find(r, 'boxCreated')), 'Created: ', boxDetails.reg_date, 'PURPLE');
      kt.decorate(h(find(r, 'boxEdited')), 'Last edited: ', boxDetails.last_edited, 'PURPLE');
    };
    fields();
    vm.boxData.observe(this, (it) => { if (it == null) return; boxDetails = it; fields(); });
    onClick(find(r, 'otherBoxesBtn'), () => {
      ['boxData', 'currentBox', 'filesList', 'openedFiles'].forEach(clearState);
      redirector.redirectToBoxesList();
    });
    swipeRefresh(find(r, 'refreshBoxInfo'), () => { boxDetails = fetchBoxData(vm.boxData.value.name); fields(); });
  }
}

class BoxEditor extends Fragment {
  constructor() { super(); this.root = view('fragment_box_editor'); }
  created() { this.render(); }
  render() {
    const r = this.root;
    const boxData = vm.boxData.value;
    const username = boxData.owner_name;
    const submitBtn = find(r, 'editBoxBtn');
    let nameColor = boxData.name_color, descriptionColor = boxData.description_color;
    const nameColorBtn = find(r, 'setBoxNameColor'), descriptionColorBtn = find(r, 'editDescriptionColor');
    colorizeButton(nameColorBtn, nameColor);
    colorizeButton(descriptionColorBtn, descriptionColor);
    // BoxFormEditor.fetchAccessLists
    let editorsCopy = [], viewersCopy = [];
    const [st, lists] = api('getAccessLists', { username: boxData.owner_name, boxName: boxData.name });
    if (st === 200) { editorsCopy = lists.editors; viewersCopy = lists.limitedUsers; }
    const modified = { name: false, editors: false, privacy: false, desc: false, nameColor: false, descColor: false };
    let nameCorrect = true;
    const nameInput = find(r, 'boxNameInput'), nameWarning = find(r, 'boxNameWarning'), descriptionInput = find(r, 'editDescription');
    const checkAll = () => {
      const initial = vm.boxData.value;
      modified.name = nameInput._input.value !== initial.name;
      if (!nameCorrect && modified.name) return decorateSubmitter(submitBtn, false);
      modified.editors = JSON.stringify(editors.getAddedUsers().map((u) => u.name)) !== JSON.stringify(editorsCopy.map((u) => u.name));
      const logoEdited = logoEditor.getLogo()[1];
      const [currentPrivacy, limitedUsers] = privacy.getPrivacy();
      let privacyChanged = currentPrivacy !== initial.access_level;
      if (!privacyChanged && currentPrivacy === 'limited')
        privacyChanged = JSON.stringify(limitedUsers.map((u) => u.name)) !== JSON.stringify(viewersCopy.map((u) => u.name));
      modified.privacy = privacyChanged;
      modified.desc = descriptionInput._input.value !== initial.description;
      modified.nameColor = nameColor !== initial.name_color;
      modified.descColor = descriptionColor !== initial.description_color;
      decorateSubmitter(submitBtn, Object.values(modified).some(Boolean) || logoEdited);
    };
    const logoEditor = boxLogoEditor(r, boxData.logo, checkAll);
    const editors = accessList(find(r, 'editorsContainer'), editorsCopy, username, () => { modified.editors = true; checkAll(); });
    const privacy = boxPrivacy(find(r, 'boxPrivacy'), boxData.access_level, viewersCopy, username, () => { modified.privacy = true; checkAll(); }, checkAll);
    nameInput._input.style.color = nameColor;
    descriptionInput._input.style.color = descriptionColor;
    decorateSubmitter(submitBtn, false);
    onInput(nameInput, (input) => {
      const { warning, correct } = JSON.parse(kt.boxNameCheck(username, input));
      nameCorrect = correct;
      // BoxFormEditor.handleWarning: the box's own name shows no warning
      const shown = input !== vm.boxData.value.name ? input : '';
      if (!shown) { tint(nameInput, APP.BLUE); nameWarning.textContent = ''; } else {
        nameWarning.textContent = warning;
        tint(nameInput, warning ? APP.CRIMSON : APP.GREEN);
      }
      checkAll();
    });
    setText(nameInput, boxData.name);
    onInput(descriptionInput, checkAll);
    setText(descriptionInput, boxData.description);
    colorPicker(nameColorBtn, 'Box name color', () => nameColor, (c) => { colorizeButton(nameColorBtn, c); nameInput._input.style.color = c; nameColor = c; checkAll(); });
    colorPicker(descriptionColorBtn, 'Description color', () => descriptionColor, (c) => { colorizeButton(descriptionColorBtn, c); descriptionInput._input.style.color = c; descriptionColor = c; checkAll(); });
    // BoxFormEditor.handleSubmit
    onClick(submitBtn, () => {
      const boxFieldsEdited = Object.entries(modified).some(([k, v]) => k !== 'editors' && v);
      const [logo, logoModified] = logoEditor.getLogo();
      const [currentPrivacy, limitedUsers] = privacy.getPrivacy();
      const body = {
        username: boxData.owner_name, boxName: boxData.name,
        logo: logoModified ? logo : null,
        boxData: !boxFieldsEdited ? null : {
          name: modified.name ? nameInput._input.value : null,
          name_color: modified.nameColor ? nameColor : null,
          description: modified.desc ? descriptionInput._input.value : null,
          description_color: modified.descColor ? descriptionColor : null,
          access_level: currentPrivacy,
        },
        editors: modified.editors ? editors.getAddedUsers().map((u) => u.name) : null,
        limitedUsers: currentPrivacy !== 'limited' ? null : limitedUsers.map((u) => u.name),
      };
      const [status, updated] = api('editBox', body);
      if (status !== 200) return;
      const oldData = vm.boxData.value;
      const newData = { ...oldData,
        last_edited: updated.last_edited, name: updated.name ?? oldData.name, name_color: updated.name_color ?? oldData.name_color,
        description: updated.description ?? oldData.description, description_color: updated.description_color ?? oldData.description_color,
        logo: updated.logo ?? oldData.logo, access_level: updated.access_level ?? oldData.access_level };
      vm.boxData.set(newData);
      if (updated.name != null && vm.openedFiles.value != null)
        openedFiles('renamePaths', `/${newData.owner_name}/${oldData.name}`, `/${newData.owner_name}/${updated.name}`);
      toast('Edited', true);
      vm.boxEdited.set(true);
    });
    // RemoveBoxDialog
    onClick(find(r, 'removeBoxBtn'), () => confirmDialog(`Remove box "${vm.currentBox.value}"`, () => {
      const data = vm.boxData.value;
      const [st2, res2] = api('removeBox', { username: data.owner_name, boxName: data.name, confirmation: 'permitted', ownPage: true });
      if (st2 !== 200 || !res2.removed) return;
      ['currentBox', 'boxData', 'filesList', 'openedFiles'].forEach(clearState);
      redirector.redirectToBoxesList();
    }));
    vm.boxData.observe(this, (it) => {
      if (it == null || same(it, boxData)) return;
      this.dispose();
      const fresh = view('fragment_box_editor');
      this.root.replaceWith(fresh);
      this.root = fresh;
      this.render();
    });
  }
}

class BoxFiles extends Fragment {
  constructor() { super(); this.root = view('fragment_box_files'); }
  created() {
    const r = this.root;
    const editor = vm.boxData.value.editor;
    setVisible(find(r, 'addBoxFiles'), editor);
    const viewerName = vm.names.value[0];
    const pathDepthView = find(r, 'boxFilesPath'), listView = find(r, 'boxFilesList'), emptyList = find(r, 'emptyFilesList');
    const searchView = find(r, 'boxesFilesSearch'), goBackView = find(r, 'goBackOption');
    let pathDepth = vm.boxData.value.name;
    // EntriesManipulator.fillFilesState
    if (vm.filesList.value == null) {
      const box = vm.boxData.value;
      const [st, res] = api('getPathFiles', { boxPath: [box.owner_name, box.name], viewerName, initial: true });
      if (st === 200) vm.filesList.set(res);
    }
    const shortenName = (s) => (s.length < 17 ? s : `${s.slice(0, 18)}...`);
    const adapter = listAdapter(listView, 'files_list_item', (row, file) => {
      const fileName = find(row, 'boxFileName'), rename = find(row, 'entryRename'), remove = find(row, 'entryRemove'), typeIcon = find(row, 'boxFileTypeIcon');
      fileName.textContent = shortenName(file.name);
      setVisible(rename, editor); setVisible(remove, editor);
      [fileName, typeIcon].forEach((v) => { v.classList.add('clickable'); v.addEventListener('click', () => {
        const size = pathDepth.split(' / ').length;
        if (file.type === 'dir') redirectDir(file.name, size); else openFile(file.name, file.type);
      }); });
      fileName.setAttribute('role', 'button');
      fileName.tabIndex = 0;
      fileName.addEventListener('keydown', (e) => { if (e.key === 'Enter') fileName.click(); });
      if (editor) {
        rename.setAttribute('role', 'button'); rename.setAttribute('aria-label', 'Rename ' + file.name);
        remove.setAttribute('role', 'button'); remove.setAttribute('aria-label', 'Remove ' + file.name);
        rename.addEventListener('click', () => renameFile(file.name, file.type));
        remove.addEventListener('click', () => removeFile(file.name, file.type));
      }
      typeIcon._img.hidden = false;
      typeIcon._img.src = bitmap(file.type === 'dir' ? '@drawable/folder_icon' : '@drawable/file_icon');
    }, emptyList);
    const setEntries = () => {
      const all = vm.filesList.value?.entries.dir?.src ?? [];
      const input = searchView._input.value;
      adapter.items = all.filter((f) => f.name.includes(input));
      adapter.notify();
    };
    const configurePath = (path) => {
      pathDepth = path;
      const pathArr = path.split(' / ');
      pathDepthView.textContent = '';
      pathArr.forEach((dir, i) => {
        const span = document.createElement('span');
        span.textContent = dir;
        if (i === 0) { span.style.color = vm.boxData.value.name_color; span.style.fontWeight = '700'; } else if (i < pathArr.length - 1) span.style.color = APP.BLUE;
        if (i < pathArr.length - 1) {
          span.classList.add('clickable');
          span.setAttribute('role', 'link');
          span.addEventListener('click', () => redirectDir(dir, i));
        }
        pathDepthView.append(span);
        if (i < pathArr.length - 1) pathDepthView.append(' / ');
      });
    };
    const redirectDir = (name, position) => {
      const owner = vm.boxData.value.owner_name;
      let boxPath = pathDepth.split(' / ');
      if (position < boxPath.length) boxPath = boxPath.slice(0, position + 1); else boxPath.push(name);
      boxPath.unshift(owner);
      const [st, res] = api('getPathFiles', { boxPath, viewerName, initial: true });
      if (st !== 200) return;
      vm.filesList.set(res);
      searchView._input.value = '';
      configurePath(boxPath.slice(1).join(' / '));
      setEntries();
      setVisible(goBackView, boxPath.length > 2);
    };
    const openFile = (name, type) => {
      const [viewer, owner] = vm.names.value;
      const path = pathDepth.split(' / ');
      path.unshift(owner);
      const [st, res] = api('getFileEntries', { boxPath: path, viewerName: viewer, fileName: name, type });
      if (st !== 200) return;
      const openedFile = { opened: true, name, filePath: '/' + path.join('/'), src: res.foundData, type };
      // goToOpenedFiles
      const list = vm.openedFiles.value;
      const idx = list ? list.findIndex((f) => f.name === openedFile.name && f.filePath === openedFile.filePath) : -1;
      if (idx === -1) openedFiles('add', JSON.stringify(openedFile));
      else if (!list[idx].opened) openedFiles('open', idx);
      vm.redirected.set(true);
    };
    const renameFile = (name, type) => {
      const fullPath = pathDepth.replace(/ /g, '');
      inputDialog(`Rename ${type} "${name} (${fullPath}/${name})"`, (newName) => {
        const [viewer, owner] = vm.names.value;
        const path = fullPath.split('/');
        path.unshift(owner);
        const [st, res] = api('renameFile', { boxPath: path, viewerName: viewer, fileName: name, newName });
        if (st !== 200) return;
        vm.boxData.set({ ...vm.boxData.value, last_edited: res.last_edited });
        const cur = vm.filesList.value.entries;
        vm.filesList.set({ entries: { ...cur, dir: { ...cur.dir, src: cur.dir.src.map((f) => (f.name === name ? { ...f, name: newName } : f)) } } });
        const opened = vm.openedFiles.value;
        if (!opened) return;
        if (type === 'dir') openedFiles('renamePaths', `/${owner}/${fullPath}/${name}`, `/${owner}/${fullPath}/${newName}`);
        else opened.forEach((file, i) => {
          const filePath = file.filePath.startsWith('/') ? file.filePath : '/' + file.filePath;
          if (name === file.name && filePath === `/${owner}/${fullPath}`) openedFiles('rename', i, newName);
        });
      });
    };
    const removeFile = (name, type) => {
      const fullPath = pathDepth.replace(/ /g, '');
      confirmDialog(`Remove ${type} "${name} (${fullPath}/${name})"`, () => {
        const path = fullPath.split('/');
        const [viewer, owner] = vm.names.value;
        path.unshift(owner);
        const [st, res] = api('removeFile', { boxPath: path, viewerName: viewer, fileName: name, type });
        if (st !== 200) return;
        vm.boxData.set({ ...vm.boxData.value, last_edited: res.last_edited });
        const cur = vm.filesList.value.entries;
        vm.filesList.set({ entries: { ...cur, dir: { ...cur.dir, src: cur.dir.src.filter((f) => f.name !== name) } } });
        if (vm.openedFiles.value != null) { path.push(name); openedFiles('closeByPath', path.join('/')); }
      });
    };
    const addNewFile = (type, name, src = null) => {
      const [viewer, owner] = vm.names.value;
      const path = pathDepth.split(' / ');
      path.unshift(owner);
      const entries = src == null ? null : `data:image/${name.split('.').pop()};base64,${src}`;
      const [st, res] = api('createFile', { boxPath: path, viewerName: viewer, fileName: name, type, src: entries });
      if (st !== 201) return;
      const newEntries = type === 'dir' ? res.created.dir : res.created.file;
      vm.boxData.set({ ...vm.boxData.value, last_edited: res.last_edited });
      const cur = vm.filesList.value.entries;
      vm.filesList.set({ entries: { ...cur, dir: { ...cur.dir, src: newEntries.src } } });
      if (type === 'dir') return;
      openedFiles('add', JSON.stringify({ opened: true, name, filePath: '/' + path.join('/'), src: src ?? '', type }));
      vm.redirected.set(true);
    };
    if (editor) {
      onClick(find(r, 'addFileIcon'), () => inputDialog('Add file', (n) => addNewFile('file', n)));
      onClick(find(r, 'addDirIcon'), () => inputDialog('Add directory', (n) => addNewFile('dir', n)));
      onClick(find(r, 'addImgIcon'), () => pickImage((src, filename) => {
        const name = filename.replace(/ /g, '');
        if (vm.filesList.value.entries.dir.src.some((f) => f.name === name)) return;
        addNewFile('image', name, src);
      }, false));
      ['addFileIcon', 'addDirIcon', 'addImgIcon'].forEach((id, i) => {
        const el = find(r, id);
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', ['Add file', 'Add directory', 'Add image'][i]);
        el.classList.add('clickable');
      });
    }
    configurePath(pathDepth);
    setEntries();
    setVisible(goBackView, pathDepth.split(' / ').length > 1);
    goBackView.classList.add('clickable');
    goBackView.addEventListener('click', () => redirectDir('', pathDepth.split(' / ').length - 2));
    onInput(searchView, (input) => {
      const emptyMsg = 'This directory is empty', foundNoneMsg = 'No files or directories were found';
      emptyList.textContent = input ? foundNoneMsg : emptyMsg;
      setEntries();
    });
    vm.filesList.observe(this, (it) => { if (it) setEntries(); });
    vm.boxData.observe(this, (it) => {
      if (it == null || !pathDepth) return;
      const entries = pathDepth.split(' / ');
      if (entries[0] === it.name) return;
      entries[0] = it.name;
      configurePath(entries.join(' / '));
    });
    swipeRefresh(find(r, 'refreshFilesList'), () => {
      const box = vm.boxData.value;
      const [st, res] = api('getPathFiles', { boxPath: [box.owner_name, box.name], viewerName, initial: true });
      if (st !== 200) return;
      vm.filesList.set(res);
      searchView._input.value = '';
      configurePath(box.name);
      setEntries();
      setVisible(goBackView, false);
    });
  }
}

class OpenedContainer extends Fragment {
  constructor() { super(); this.root = view('fragment_box_opened_container'); }
  created() {
    const container = find(this.root, 'boxOpenedContainer');
    let position = vm.openedFiles.value != null ? 1 : 0;
    replace(this, container, position ? OpenedFilesList : OpenedFilesNone);
    vm.openedFiles.observe(this, (it) => {
      const isOpened = it != null;
      if (isOpened && position === 1) return;
      position = isOpened ? 1 : 0;
      replace(this, container, isOpened ? OpenedFilesList : OpenedFilesNone);
    });
  }
}

class OpenedFilesNone extends Fragment {
  constructor() { super(); this.root = view('no_opened_files'); }
}

class OpenedFilesList extends Fragment {
  constructor() { super(); this.root = view('fragment_box_opened_files'); }
  created() {
    const r = this.root;
    const editor = vm.boxData.value.editor;
    const username = vm.names.value[0];
    const tabsView = find(r, 'openedFilesList');
    const textArea = find(r, 'fileEditorArea'), imageArea = find(r, 'imageEditorArea');
    const [viewMode, saveFile, saveAll, zoomIn, zoomOut, copyToClipboard] =
      ['setEditModeBtn', 'saveFileBtn', 'saveAllFileBtn', 'zoomInBtn', 'zoomOutBtn', 'clipboardBtn'].map((id) => find(r, id));
    const labels = ['Edit mode', 'Save file', 'Save all files', 'Zoom in', 'Zoom out', 'Copy to clipboard'];
    [viewMode, saveFile, saveAll, zoomIn, zoomOut, copyToClipboard].forEach((b, i) => {
      b.setAttribute('role', 'button'); b.setAttribute('aria-label', labels[i]); b.title = labels[i]; b.tabIndex = 0; b.classList.add('clickable');
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter') b.click(); });
    });
    let viewModeSet = true;
    const getOpenedFile = () => vm.openedFiles.value.find((f) => f.opened);
    textArea._input.disabled = viewModeSet;
    textArea._input.wrap = 'off';
    if (!editor) { setVisible(viewMode, false); setVisible(saveFile, false); setVisible(saveAll, false); }
    else viewMode._img.src = bitmap(viewModeSet ? '@drawable/file_edit' : '@drawable/file_edit_cancel');
    let silent = false;
    textArea._input.addEventListener('input', () => {
      if (silent) return;
      // FileToolbar.handleEditFields -> OpenedFilesViewModel.editFile
      openedFiles('edit', textArea._input.value);
    });
    onClick(viewMode, () => {
      viewModeSet = !viewModeSet;
      textArea._input.disabled = viewModeSet;
      viewMode._img.src = bitmap(viewModeSet ? '@drawable/file_edit' : '@drawable/file_edit_cancel');
      toast(viewModeSet ? 'View mode set' : 'Edit mode set');
      if (viewModeSet) { openedFiles('viewMode'); setArea(getOpenedFile().src); }
    });
    const saveEditedFiles = (openedOnly) => {
      const editedFiles = vm.openedFiles.value.filter((f) => (openedOnly ? f.opened && f.edited != null : f.edited != null));
      if (!editedFiles.length) return;
      const files = editedFiles.map((f) => ({ src: f.edited, filePathStr: `${f.filePath}/${f.name}` }));
      const [st, res] = api('saveFiles', { editorName: username, files });
      if (st !== 200) return;
      openedFiles('write', openedOnly);
      vm.boxData.set({ ...vm.boxData.value, last_edited: res.last_edited });
      toast(openedOnly ? `File "${editedFiles[0].name}" has been saved` : 'All edited files have been saved');
    };
    onClick(saveFile, () => saveEditedFiles(true));
    onClick(saveAll, () => saveEditedFiles(false));
    let textSize = dp(textArea._attrs.textSize);
    const zoom = (increase) => {
      const acc = increase ? textSize + 2 : textSize - 2;
      if (acc > 36 || acc < 16) return;
      textSize = acc;
      textArea._input.style.fontSize = acc + 'px';
    };
    onClick(zoomIn, () => zoom(true));
    onClick(zoomOut, () => zoom(false));
    onClick(copyToClipboard, async () => {
      try { await navigator.clipboard.writeText(textArea._input.value); } catch { /* the toast still shows, as on the phone */ }
      toast(`File "${getOpenedFile().name}" copied to clipboard`);
    });
    const setArea = (text) => { silent = true; textArea._input.value = text; silent = false; };
    // FileToolbar.onOpenFile
    const onOpenFile = () => {
      const openedFile = getOpenedFile();
      const isImage = openedFile.type === 'image';
      setVisible(imageArea, isImage);
      setVisible(textArea.closest('.av-ScrollView'), !isImage);
      if (editor) [viewMode, saveFile, saveAll].forEach((b) => setVisible(b, !isImage));
      [zoomOut, zoomIn, copyToClipboard].forEach((b) => setVisible(b, !isImage));
      if (isImage) setImage(imageArea, openedFile.src); else setArea(openedFile.edited ?? openedFile.src);
    };
    // TabsAdapter
    const renderTabs = () => {
      const files = vm.openedFiles.value ?? [];
      tabsView.replaceChildren(...files.map((item, position) => {
        const tab = view('opened_file');
        const textView = find(tab, 'nameField'), closeIcon = find(tab, 'closeBtn');
        textView.textContent = item.name;
        Object.assign(tab.style, drawableCss(item.opened ? 'file_tab_opened' : 'file_tab_border'));
        textView.style.color = item.opened ? APP.BLACK : APP.BLUE;
        textView.classList.add('clickable');
        textView.setAttribute('role', 'tab');
        textView.setAttribute('aria-selected', String(item.opened));
        textView.addEventListener('click', () => openedFiles('open', position));
        closeIcon.setAttribute('role', 'button');
        closeIcon.setAttribute('aria-label', 'Close ' + item.name);
        closeIcon.classList.add('clickable');
        closeIcon.addEventListener('click', () => openedFiles('close', position));
        return tab;
      }));
    };
    // FilesViewer: re-render when names, paths or the opened tab change
    let saved = null;
    const changed = (files) => !saved || files.length !== saved.length
      || files.some((f, i) => f.name !== saved[i].name || f.filePath !== saved[i].filePath || f.opened !== saved[i].opened);
    const onChange = (files) => {
      if (files == null || !changed(files)) return;
      renderTabs();
      onOpenFile();
      saved = files.map((f) => ({ ...f }));
    };
    onChange(vm.openedFiles.value);
    vm.openedFiles.observe(this, onChange);
  }
}

// ================================================================== page ==

/** Keeps the phone at its real size when there is room, scaled down otherwise. */
function fitPhone() {
  const phone = $('.phone'), holder = $('.phone-holder');
  const avail = holder.clientWidth;
  const natural = 432, tall = 832;
  const z = Math.min(1, avail / natural, (innerHeight - 32) / tall);
  phone.style.zoom = String(z);
}

async function boot() {
  const status = $('#boot');
  try {
    const [mod] = await Promise.all([import('./kotlin-wasm/dichbox.mjs'), loadResources(), initMock()]);
    kt = mod;
    // like the DichBox showcase: the first demo user starts signed in
    const first = demoCredentials()[0];
    const [, signed] = api('enterUser', { email: first.email, passwd: first.passwd });
    signedFile = [...signed.user_uid].reverse().join('');
    screen = $('#screen');
    const statusBar = () => {
      const c = themeAttr('statusBarColor');
      screen.style.setProperty('--status', c);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', c);
    };
    statusBar();
    window.addEventListener('themechange', statusBar);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', statusBar);
    const activity = new MainActivity();
    screen.querySelector('.app').replaceChildren(activity.root);
    activity.created();
    status.remove();
  } catch (e) {
    console.error(e, e.stack);
    status.className = 'err';
    status.textContent = `Could not start the app: ${e.message}`;
  }
}

window.addEventListener('resize', fitPhone);
fitPhone();
boot();
