// Loads the legacy i18n.js + shared.js in a stubbed browser and checks language persistence.
import fs from 'node:fs';
import vm from 'node:vm';

const root = process.argv[2];
function makeContext(store) {
  const win = {};
  const el = () => ({ addEventListener() {}, querySelectorAll: () => [], setAttribute() {}, classList: { add() {}, remove() {}, toggle() {} }, style: {} });
  const document = {
    ...el(),
    documentElement: el(),
    addEventListener() {},
    dispatchEvent() {},
    getElementById: () => null,
    querySelector: () => null,
    createElement: el,
    body: el(),
    readyState: 'complete',
  };
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  Object.assign(win, {
    document, localStorage, navigator: { language: 'en-US', languages: ['en-US'] },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {}, location: { search: '', pathname: '/', hash: '' },
    CustomEvent: class { constructor(n, o) { this.type = n; this.detail = o?.detail; } },
    setTimeout, clearTimeout, console, sessionStorage: localStorage,
  });
  win.window = win;
  return vm.createContext(win);
}
function load(ctx, file) {
  vm.runInContext(fs.readFileSync(`${root}/frontend/${file}`, 'utf8'), ctx, { filename: file });
}
const results = [];
function check(name, ok) { results.push({ name, ok: Boolean(ok) }); }

{ // stored ru, page has only en/es: displays English, storage keeps ru, load-time call does not erase it
  const store = { 'amistoso-lang': 'ru' };
  const ctx = makeContext(store);
  load(ctx, 'i18n.js'); load(ctx, 'shared.js');
  vm.runInContext("setAppLanguage(_loadSavedLanguage());", ctx);
  check('ru page shows English', vm.runInContext('getAppLanguage()', ctx) === 'en');
  check('stored ru survives load', store['amistoso-lang'] === 'ru');
}
{ // stored es still works
  const store = { 'amistoso-lang': 'es' };
  const ctx = makeContext(store);
  load(ctx, 'i18n.js'); load(ctx, 'shared.js');
  vm.runInContext("setAppLanguage(_loadSavedLanguage());", ctx);
  check('es shows Spanish', vm.runInContext('getAppLanguage()', ctx) === 'es');
  check('es stays stored', store['amistoso-lang'] === 'es');
}
{ // explicit choices persist; unknown language is not saved
  const store = { 'amistoso-lang': 'ru' };
  const ctx = makeContext(store);
  load(ctx, 'i18n.js'); load(ctx, 'shared.js');
  vm.runInContext("setDisplayLanguage('es')", ctx);
  check('explicit es saved', store['amistoso-lang'] === 'es' && vm.runInContext('getAppLanguage()', ctx) === 'es');
  vm.runInContext("setDisplayLanguage('ru')", ctx);
  check('unknown ru shows English and is not saved', vm.runInContext('getAppLanguage()', ctx) === 'en' && store['amistoso-lang'] === 'es');
  vm.runInContext("setDisplayLanguage('en')", ctx);
  check('explicit en saved', store['amistoso-lang'] === 'en');
}
{ // a page that has ru messages uses it
  const store = { 'amistoso-lang': 'ru' };
  const ctx = makeContext(store);
  load(ctx, 'i18n.js');
  vm.runInContext("window.__i18n.messages.ru = { txt_x: 'x' };", ctx);
  load(ctx, 'shared.js');
  vm.runInContext("setAppLanguage(_loadSavedLanguage());", ctx);
  check('ru used when messages exist', vm.runInContext('getAppLanguage()', ctx) === 'ru');
  check('ru label from table', vm.runInContext('_langInfo("ru").short', ctx) === 'RU');
}
console.log(JSON.stringify(results));
