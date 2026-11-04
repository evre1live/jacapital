// Набор монет офиса: крупные монеты по капитализации (список кандидатов ниже), у которых есть бессрочный фьючерс Binance в USDT
// не меньше года (тренду нужна история). Из кандидатов берутся самые ликвидные — по среднему суточному объёму за 30 дней,
// а не за сутки: разовый всплеск объёма у мелкого токена не должен пускать его в портфель.
// Список пересчитывается раз в неделю; монеты с открытыми позициями остаются, пока позиции не закрыты, но новых сделок по ним нет.
import fs from 'node:fs';
import path from 'node:path';

const STABLE = new Set(['USDC', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'BUSD', 'USDE', 'PYUSD', 'RLUSD', 'USD1', 'EUR', 'EURI', 'AEUR', 'XUSD', 'BFUSD', 'USDS']);
const MUST = ['BTC', 'ETH'];
// крупные монеты (топ-50 по капитализации в 2026 году без стейблкоинов и биржевых токенов вне Binance); тикеры фьючерсов Binance
export const LARGE_CAPS = ['BTC', 'ETH', 'XRP', 'BNB', 'SOL', 'TRX', 'DOGE', 'ADA', 'BCH', 'LINK', 'HYPE', 'XLM', 'SUI', 'AVAX', 'LTC', 'HBAR', 'TON', '1000SHIB', 'DOT',
  'UNI', 'XMR', 'ZEC', 'AAVE', 'NEAR', 'APT', 'ETC', 'ICP', 'ONDO', 'ENA', '1000PEPE', 'TAO', 'ARB', 'FIL', 'ATOM', 'OP', 'WLD', 'ALGO', 'VET', 'RENDER', 'INJ',
  'SEI', 'TIA', 'POL', 'CRV', 'LDO', 'JUP', 'STX', 'IMX', 'KAS', 'FET'];
const VERSION = 2;
const DAY = 864e5;

export async function resolveUniverse({ex, CFG, log = console.log}){
  if (!CFG.coinsAuto) return CFG.coins;
  const file = path.join(CFG.dataDir, 'universe.json');
  let saved = null; try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const held = heldCoins(CFG);
  if (saved && saved.v === VERSION && Array.isArray(saved.coins) && saved.coins.length && saved.size === CFG.universeSize && Date.now() - saved.ts < 7 * DAY){
    CFG.coinsActive = saved.coins;
    const coins = [...new Set([...saved.coins, ...held])];
    log(`[universe] ${saved.coins.length} монет (список от ${new Date(saved.ts).toISOString().slice(0, 10)})${coins.length > saved.coins.length ? `; ещё ${coins.length - saved.coins.length} — только до закрытия позиций` : ''}`);
    return coins;
  }
  try {
    await ex.loadMarkets();
    const now = Date.now();
    const cands = Object.values(ex.markets).filter(m => m && m.swap && m.linear && m.quote === 'USDT' && m.settle === 'USDT' && m.active !== false
      && (!m.info || !m.info.contractType || m.info.contractType === 'PERPETUAL')
      && (!m.info || !m.info.underlyingType || m.info.underlyingType === 'COIN')
      && !STABLE.has(m.base) && LARGE_CAPS.includes(m.base)
      && (!m.info || !m.info.onboardDate || now - +m.info.onboardDate > 365 * DAY));
    // средний суточный оборот в USDT за 30 закрытых дней
    const ranked = [];
    for (const m of cands){
      try { const rows = await ex.fetchOHLCV(m.symbol, '1d', undefined, 31); const done = rows.slice(0, -1).slice(-30);
        const vol = done.reduce((a, r) => a + (+r[5] || 0) * (+r[4] || 0), 0) / Math.max(1, done.length); if (done.length >= 20 && vol > 0) ranked.push({base: m.base, vol}); }
      catch {}
    }
    ranked.sort((a, b) => b.vol - a.vol);
    const pick = [];
    for (const b of MUST) if (ranked.some(x => x.base === b)) pick.push(b);
    for (const x of ranked){ if (pick.length >= CFG.universeSize) break; if (!pick.includes(x.base)) pick.push(x.base); }
    if (pick.length < 6) throw new Error('слишком мало монет: ' + pick.length);
    const vols = Object.fromEntries(ranked.filter(x => pick.includes(x.base)).map(x => [x.base, Math.round(x.vol)]));
    try { fs.mkdirSync(CFG.dataDir, {recursive: true}); fs.writeFileSync(file, JSON.stringify({v: VERSION, ts: Date.now(), size: CFG.universeSize, coins: pick, vols})); } catch {}
    CFG.coinsActive = pick;
    const coins = [...new Set([...pick, ...held])];
    log(`[universe] обновлён: ${pick.length} крупных монет с наибольшим оборотом за 30 дней — ${pick.join(', ')}${coins.length > pick.length ? `; до закрытия позиций остаются: ${coins.filter(c => !pick.includes(c)).join(', ')}` : ''}`);
    return coins;
  } catch (e) {
    const base = saved && saved.v === VERSION && saved.coins && saved.coins.length ? saved.coins : CFG.coinsFallback;
    CFG.coinsActive = base;
    const fallback = [...new Set([...base, ...held])];
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
