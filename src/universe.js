// Набор монет офиса: самые ликвидные бессрочные фьючерсы Binance в USDT (по объёму за сутки).
// Только криптовалюты (без стейблкоинов, индексов и токенизированных акций), торгуются на Binance не меньше года —
// тренду нужна история. Список пересчитывается раз в неделю; монеты с открытыми позициями остаются, пока позиции не закрыты.
import fs from 'node:fs';
import path from 'node:path';

const STABLE = new Set(['USDC', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'BUSD', 'USDE', 'PYUSD', 'RLUSD', 'USD1', 'EUR', 'EURI', 'AEUR', 'XUSD', 'BFUSD', 'USDS']);
const MUST = ['BTC', 'ETH'];
const DAY = 864e5;

export async function resolveUniverse({ex, CFG, log = console.log}){
  if (!CFG.coinsAuto) return CFG.coins;
  const file = path.join(CFG.dataDir, 'universe.json');
  let saved = null; try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const held = heldCoins(CFG);
  if (saved && Array.isArray(saved.coins) && saved.coins.length && saved.size === CFG.universeSize && Date.now() - saved.ts < 7 * DAY){
    const coins = [...new Set([...saved.coins, ...held])];
    log(`[universe] ${coins.length} монет (список от ${new Date(saved.ts).toISOString().slice(0, 10)})`);
    return coins;
  }
  try {
    await ex.loadMarkets();
    const now = Date.now();
    const cands = Object.values(ex.markets).filter(m => m && m.swap && m.linear && m.quote === 'USDT' && m.settle === 'USDT' && m.active !== false
      && (!m.info || !m.info.contractType || m.info.contractType === 'PERPETUAL')
      && (!m.info || !m.info.underlyingType || m.info.underlyingType === 'COIN')
      && !STABLE.has(m.base) && !/^(BTCDOM|DEFI|.*INDEX)$/.test(m.base)
      && (!m.info || !m.info.onboardDate || now - +m.info.onboardDate > 365 * DAY));
    const tickers = await ex.fetchTickers(cands.map(m => m.symbol));
    const ranked = cands.map(m => ({base: m.base, vol: +(tickers[m.symbol] && tickers[m.symbol].quoteVolume) || 0})).filter(x => x.vol > 0).sort((a, b) => b.vol - a.vol);
    const pick = [];
    for (const b of MUST) if (ranked.some(x => x.base === b)) pick.push(b);
    for (const x of ranked){ if (pick.length >= CFG.universeSize) break; if (!pick.includes(x.base)) pick.push(x.base); }
    if (pick.length < 6) throw new Error('слишком мало монет: ' + pick.length);
    const vols = Object.fromEntries(ranked.filter(x => pick.includes(x.base)).map(x => [x.base, Math.round(x.vol)]));
    try { fs.mkdirSync(CFG.dataDir, {recursive: true}); fs.writeFileSync(file, JSON.stringify({ts: Date.now(), size: CFG.universeSize, coins: pick, vols})); } catch {}
    const coins = [...new Set([...pick, ...held])];
    log(`[universe] обновлён: ${coins.length} монет по объёму фьючерсов Binance — ${coins.join(', ')}`);
    return coins;
  } catch (e) {
    const fallback = saved && saved.coins && saved.coins.length ? [...new Set([...saved.coins, ...held])] : [...new Set([...CFG.coinsFallback, ...held])];
    log(`[universe] не удалось обновить (${String(e.message || e).slice(0, 160)}); беру ${saved ? 'прежний список' : 'запасной список'}: ${fallback.join(', ')}`);
    return fallback;
  }
}
// объёмы для подписи и размеров плиток на тепловой карте
export function universeVolumes(CFG){ try { return JSON.parse(fs.readFileSync(path.join(CFG.dataDir, 'universe.json'), 'utf8')).vols || {}; } catch { return {}; } }
// монеты с открытыми позициями на любом счёте — их нельзя выбросить из набора
function heldCoins(CFG){
  try { const s = JSON.parse(fs.readFileSync(path.join(CFG.dataDir, 'state.json'), 'utf8')); return [...new Set(Object.values(s.books || {}).flatMap(b => (b.positions || []).map(p => p.sym)))]; }
  catch { return []; }
}
