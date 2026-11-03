// Новости: RSS профильных изданий → монеты, тон, важность (через Claude или словарь)
import {EventEmitter} from 'node:events';
import {askJSON, aiEnabled} from './claude.js';

const COIN_WORDS = {
  BTC: /\b(bitcoin|btc)\b/i, ETH: /\b(ethereum|ether|eth)\b/i, SOL: /\b(solana|sol)\b/i, BNB: /\b(bnb|binance)\b/i,
  XRP: /\b(xrp|ripple)\b/i, DOGE: /\b(dogecoin|doge)\b/i, ADA: /\b(cardano|ada)\b/i, TON: /\b(toncoin|ton)\b/i,
  AVAX: /\b(avalanche|avax)\b/i, LINK: /\b(chainlink)\b/i, LTC: /\b(litecoin|ltc)\b/i, TRX: /\b(tron|trx)\b/i, DOT: /\b(polkadot)\b/i,
};
const MARKET_WORDS = /\b(crypto|market|etf|stablecoin|fed|sec|regulat|exchange|bitcoin|defi|token|altcoin|liquidat)/i;
const POS = /\b(surges?|soars?|rall(y|ies)|jumps?|gains?|climbs?|record high|all-time high|approv(e|es|al|ed)|inflows?|adopt(s|ion)?|partnership|launch(es)?|upgrade[sd]?|bullish|breakout|rebounds?|recovers?|buys|accumulat\w*|lists?)\b/gi;
const NEG = /\b(plunges?|crash(es)?|falls?|drops?|slumps?|tumbles?|sinks?|hack(ed|s)?|exploit(ed|s)?|drain(ed|s)?|lawsuits?|sues?|bans?|outflows?|liquidations?|bearish|sell-?off|probes?|investigat\w*|delist\w*|fraud|declines?|halts?|warns?|thefts?|stolen|launder\w*|outage|bankrupt\w*)\b/gi;

function decode(s){
  return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}
export function parseRSS(xml){
  const items = [];
  const re = /<item[\s>]([\s\S]*?)<\/item>/gi; let m;
  while ((m = re.exec(xml))){
    const body = m[1];
    const tag = t => { const r = body.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`, 'i')); return r ? decode(r[1]) : ''; };
    const title = tag('title'); if (!title) continue;
    let link = tag('link'); if (!link){ const l = body.match(/<link[^>]*href="([^"]+)"/i); if (l) link = l[1]; }
    const guid = tag('guid') || link || title;
    const ts = Date.parse(tag('pubDate') || tag('dc:date') || '') || Date.now();
    items.push({title, link, guid, ts});
  }
  return items;
}
export function lexicon(title, coins){
  const found = coins.filter(c => COIN_WORDS[c] && COIN_WORDS[c].test(title));
  const pos = (title.match(POS) || []).length, neg = (title.match(NEG) || []).length;
  const tot = pos + neg;
  const tone = tot ? (pos - neg) / tot * Math.min(1, 0.45 + tot * 0.25) : 0;
  const relevant = found.length || MARKET_WORDS.test(title);
  return {coins: found, tone, importance: relevant ? (tot ? 0.55 : 0.3) : 0};
}

const MOCK_HEAD = [
  ['{c} ETF sees record inflows as institutions return', 0.7], ['Major payment network adds {c} support', 0.6], ['{c} network upgrade cuts fees threefold', 0.5],
  ['Whales move large amounts of {c} to exchanges', -0.5], ['Exchange halts {c} withdrawals after exploit', -0.8], ['Regulator opens probe into {c} issuer', -0.6],
  ['Crypto market liquidations top $500 million', -0.6], ['Stablecoin supply hits all-time high', 0.4], ['US inflation cools more than expected', 0.5],
];
const MOCK_NAMES = {BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', BNB: 'BNB', XRP: 'XRP', DOGE: 'Dogecoin'};

export class News extends EventEmitter {
  constructor(CFG, state, ids){ super(); this.CFG = CFG; this.state = state; this.ids = ids; this.status = {ok: true, error: '', lastOk: 0}; this.first = !state.seenNews || !state.seenNews.length; state.seenNews ||= []; }
  seen(g){ return this.state.seenNews.includes(g); }
  markSeen(g){ this.state.seenNews.push(g); if (this.state.seenNews.length > 800) this.state.seenNews.splice(0, this.state.seenNews.length - 800); }
  async fetchAll(){
    if (this.CFG.feeds === 'mock') return this.mockItems();
    const out = []; const errs = [];
    await Promise.all(this.CFG.feeds.map(async f => {
      try {
        const r = await fetch(f.url, {headers: {'User-Agent': 'JACapitalOffice/1.0 (+rss reader)', 'Accept': 'application/rss+xml, application/xml, text/xml'}, signal: AbortSignal.timeout(15000)});
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const items = parseRSS(await r.text()).slice(0, 25);
        for (const it of items) out.push({...it, source: f.name, rel: f.rel});
      } catch (e) { errs.push(`${f.name}: ${e.message}`); }
    }));
    this.status = errs.length === this.CFG.feeds.length ? {ok: false, error: 'Новости недоступны: ' + errs.join('; '), lastOk: this.status.lastOk} : {ok: true, error: errs.join('; '), lastOk: Date.now()};
    return out;
  }
  mockItems(){
    if (!this.first && Math.random() > 0.55) return [];
    const n = this.first ? 4 : 1; const out = [];
    for (let i = 0; i < n; i++){
      const [t, s] = MOCK_HEAD[Math.floor(Math.random() * MOCK_HEAD.length)];
      const c = this.CFG.coins[Math.floor(Math.random() * this.CFG.coins.length)];
      const title = t.replace('{c}', MOCK_NAMES[c] || c);
      out.push({title, link: '', guid: 'mock-' + Date.now() + '-' + i, ts: Date.now() - (this.first ? (i + 1) * 900000 : 0), source: ['CoinDesk', 'Decrypt', 'Cointelegraph'][i % 3], rel: [0.88, 0.8, 0.75][i % 3], mockTone: s});
    }
    this.status = {ok: true, error: '', lastOk: Date.now()};
    return out;
  }
  async poll(){
    const all = await this.fetchAll();
    const fresh = all.filter(x => !this.seen(x.guid) && Date.now() - x.ts < 6 * 3.6e6).sort((a, b) => b.ts - a.ts);
    const unique = []; const titles = new Set();
    for (const x of fresh){ const k = x.title.toLowerCase().slice(0, 60); if (titles.has(k)) continue; titles.add(k); unique.push(x); }
    for (const x of all) this.markSeen(x.guid);
    const batch = unique.slice(0, this.first ? 10 : 12);
    if (!batch.length){ this.lastWasFirst = this.first; this.first = false; return []; }
    const analysed = await this.analyse(batch);
    const items = [];
    for (let i = 0; i < batch.length; i++){
      const b = batch[i], a = analysed[i];
      if (!a || a.importance < 0.25) continue;
      items.push({id: this.ids(), ts: b.ts, title: b.title, titleRu: a.ru || '', link: b.link, source: b.source, rel: b.rel, coins: a.coins, s: Math.max(-1, Math.min(1, a.tone)), importance: a.importance, by: a.by});
    }
    const wasFirst = this.first; this.first = false; this.lastWasFirst = wasFirst;
    for (const it of items.slice().reverse()){ this.state.news.unshift(it); }
    this.state.news.sort((a, b) => b.ts - a.ts); if (this.state.news.length > 60) this.state.news.length = 60;
    this.emit('items', items, wasFirst);
    return items;
  }
  async analyse(batch){
    const coins = this.CFG.coins;
    const lex = batch.map(b => { const l = lexicon(b.title, coins); if (b.mockTone != null) l.tone = b.mockTone, l.importance = 0.7; return {...l, by: 'словарь'}; });
    if (!aiEnabled()) return lex;
    try {
      const list = batch.map((b, i) => `${i}. [${b.source}] ${b.title}`).join('\n');
      const prompt = `Ты — Леон, аналитик крипторынка в торговом офисе. Для каждого заголовка определи:
- coins: какие монеты из списка ${JSON.stringify(coins)} он затрагивает напрямую (пустой массив, если новость про весь крипторынок);
- tone: влияние на цену этих монет (или всего рынка) от -1 (сильно негативно) до 1 (сильно позитивно);
- importance: от 0 до 1, насколько вероятно заметное движение цены в ближайшие часы (0 — новость не про крипторынок или не влияет);
- ru: короткий перевод заголовка на русский.
Заголовки:
${list}
Ответь только JSON-массивом вида [{"i":0,"coins":["BTC"],"tone":-0.6,"importance":0.7,"ru":"…"}].`;
      const arr = await askJSON({prompt, fast: true, maxTokens: 1800, kind: 'news'});
      if (!Array.isArray(arr)) return lex;
      return batch.map((b, i) => {
        const a = arr.find(x => +x.i === i);
        if (!a) return lex[i];
        return {coins: (Array.isArray(a.coins) ? a.coins : []).map(String).map(s => s.toUpperCase()).filter(s => coins.includes(s)), tone: +a.tone || 0, importance: Math.max(0, Math.min(1, +a.importance || 0)), ru: String(a.ru || '').slice(0, 200), by: 'Claude'};
      });
    } catch (e) {
      console.warn('[news] Claude недоступен, использую словарь:', e.message);
      return lex;
    }
  }
}
