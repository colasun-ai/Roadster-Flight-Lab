import en from './catalogs/en.json' with {type:'json'};
import es from './catalogs/es.json' with {type:'json'};
import fr from './catalogs/fr.json' with {type:'json'};
import de from './catalogs/de.json' with {type:'json'};
import ja from './catalogs/ja.json' with {type:'json'};
import ko from './catalogs/ko.json' with {type:'json'};
import traditional from './catalogs/zh-TW.json' with {type:'json'};

export const languages = Object.freeze({
  en: 'English', 'zh-CN': '简体中文', 'zh-TW': '繁體中文', ja: '日本語',
  ko: '한국어', de: 'Deutsch', fr: 'Français', es: 'Español'
});
const catalogs = {en, es, fr, de, ja, ko, 'zh-TW': traditional};
const storageKey = 'roadster.language';
export function supported(value) {
  return Object.hasOwn(languages, value) ? value : 'en';
}
function preference() {
  try { return supported(globalThis.localStorage?.getItem(storageKey)); }
  catch { return 'en'; }
}
export const locale = preference();
const escapeRegex = word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ideograph = /[\u3400-\u9fff]/;

export function translator(language) {
  const dictionary = catalogs[supported(language)];
  if (!dictionary) return value => value;
  const dynamic = [];
  const fragments = [];
  for (const key of Object.keys(dictionary).sort((a,b) => b.length - a.length)) {
    if (/\{\d+\}/.test(key)) {
      const parts = key.split(/\{\d+\}/);
      const anchor = parts.reduce((longest, s) => s.length > longest.length ? s : longest, '');
      if (anchor) dynamic.push({key, anchor, pattern: new RegExp('^'+parts.map(escapeRegex).join('([\\s\\S]*?)')+'$')});
    } else if (ideograph.test(key)) fragments.push(escapeRegex(key));
  }
  const fragmentPattern = new RegExp(fragments.join('|'), 'g');
  function translate(value) {
    if (typeof value !== 'string' || !ideograph.test(value)) return value;
    const raw = value.trim();
    let result = dictionary[raw];
    if (result === undefined) {
      for (const entry of dynamic) {
        if (!raw.includes(entry.anchor)) continue;
        const match = entry.pattern.exec(raw);
        if (match) {
          result = dictionary[entry.key].replace(/\{(\d+)\}/g, (_,i) => translate(match[Number(i)+1]));
          break;
        }
      }
    }
    result ??= raw.replace(fragmentPattern, match => dictionary[match]);
    return value.replace(raw, () => result);
  }
  return translate;
}
export const t = translator(locale);

// Only presentation strings pass through this adapter. Vehicle IDs, mode values,
// physics data, route decisions and exported diagnostic records retain their source values.
export function localizeTree(root) {
  if (locale === 'zh-CN') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n.nodeType === Node.TEXT_NODE) {
      if (['SCRIPT','STYLE','CODE','PRE'].includes(n.parentElement?.tagName) || n.parentElement?.closest('[data-language-picker]')) continue;
      const translated=t(n.data);
      if (translated!==n.data) n.data=translated;
    } else {
      if (n.tagName === 'OPTION' && !n.hasAttribute('value')) n.value=n.textContent;
      for (const key of ['aria-label','title','placeholder','alt']) {
        if (n.hasAttribute(key)) n.setAttribute(key,t(n.getAttribute(key)));
      }
    }
  }
}
export function localizedMarkup(source) {
  if (locale === 'zh-CN' || !ideograph.test(source)) return source;
  const template=document.createElement('template');
  template.innerHTML=source;
  localizeTree(template.content);
  return template.innerHTML;
}
export function initializeLanguage() {
  const select=document.getElementById('language');
  for (const [code, name] of Object.entries(languages)) {
    const option=new Option(name,code);option.lang=code;select.add(option);
  }
  select.value=locale;
  document.documentElement.lang=locale;
  localizeTree(document.body);
  document.documentElement.classList.remove('locale-pending');
  globalThis.roadsterLanguage?.select(locale);
  select.addEventListener('change', () => {
    const next=supported(select.value);
    if (next===locale) return;
    try { localStorage.setItem(storageKey,next); } catch { select.value=locale; return; }
    globalThis.roadsterLanguage?.select(next);
    location.reload();
  });
}
