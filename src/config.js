// Настройки офиса берутся из переменных окружения (см. .env.example)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// простая загрузка .env без зависимостей
const envFile = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
const env = process.env;

const DEFAULT_FEEDS = [
  {name: 'CoinDesk',      url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', rel: 0.88},
  {name: 'The Block',     url: 'https://www.theblock.co/rss.xml',                 rel: 0.85},
  {name: 'Decrypt',       url: 'https://decrypt.co/feed',                         rel: 0.80},
  {name: 'Cointelegraph', url: 'https://cointelegraph.com/rss',                   rel: 0.75},
];

function parseFeeds(s) {
  if (!s) return DEFAULT_FEEDS;
  if (s.trim() === 'mock') return 'mock';
  // формат: Имя|url|надёжность;Имя|url|надёжность
  return s.split(';').map(x => x.trim()).filter(Boolean).map(x => {
    const [name, url, rel] = x.split('|');
    return {name: name.trim(), url: (url || '').trim(), rel: Math.min(1, Math.max(0, +rel || 0.6))};
  }).filter(f => /^https?:\/\//.test(f.url));
}

const password = env.ACCESS_PASSWORD || '';
const legacyEx = (env.EXCHANGE || '').toLowerCase();
export const CFG = {
  port: +env.PORT || 3000,
  password,
  secret: env.SESSION_SECRET || crypto.createHash('sha256').update('jacapital:' + password).digest('hex'),
  // откуда брать котировки для всех счетов: binance | bybit | mock
  quotes: (env.QUOTES || (env.BINANCE_API_KEY ? 'binance' : legacyEx) || 'binance').toLowerCase(),
  // какой счёт открыть при первом запуске; дальше счёт выбирается в интерфейсе и запоминается
  mode: (env.TRADING_MODE || 'paper').toLowerCase(),           // paper | exchange (старый способ задать счёт)
  exchange: legacyEx || 'bybit',                                // для старой настройки EXCHANGE + EXCHANGE_API_KEY
  exchangeEnv: (env.EXCHANGE_ENV || 'demo').toLowerCase(),      // demo | testnet
  marketType: (env.MARKET_TYPE || 'swap').toLowerCase(),        // swap | spot
  apiKey: env.EXCHANGE_API_KEY || '',
  apiSecret: env.EXCHANGE_API_SECRET || '',
  // счёт Binance: live — настоящие деньги, demo — демо-торговля Binance, mock — имитация для проверки
  binance: {
    key: (env.BINANCE_API_KEY || (legacyEx === 'binance' ? env.EXCHANGE_API_KEY || '' : '')).trim(),
    secret: (env.BINANCE_API_SECRET || (legacyEx === 'binance' ? env.EXCHANGE_API_SECRET || '' : '')).trim(),
    env: (env.BINANCE_ENV || (legacyEx === 'binance' ? env.EXCHANGE_ENV || 'demo' : 'demo')).trim().toLowerCase(),
    maxOrderUsd: +env.BINANCE_MAX_ORDER_USD || 0,
    // прокси со статическим IP (QuotaGuard, Fixie и т. п.): на Render исходящий адрес меняется, а белый список Binance принимает только отдельные IP
    proxy: (env.BINANCE_PROXY || env.QUOTAGUARDSTATIC_URL || env.QUOTAGUARDSHIELD_URL || env.FIXIE_URL || '').trim(),
  },
  leverage: Math.max(1, Math.min(5, +env.LEVERAGE || 1)),
  coins: (env.COINS || 'BTC,ETH,SOL,BNB,XRP,DOGE').split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
  timeframe: env.TIMEFRAME || '5m',
  scanSec: Math.max(20, +env.SCAN_SECONDS || 60),
  tickerSec: Math.max(2, +env.TICKER_SECONDS || 5),
  newsSec: Math.max(60, +env.NEWS_SECONDS || 180),
  feeds: parseFeeds(env.NEWS_FEEDS),
  anthropicKey: env.ANTHROPIC_API_KEY || '',
  model: env.CLAUDE_MODEL || 'claude-sonnet-5-5',
  modelFast: env.CLAUDE_MODEL_FAST || 'claude-haiku-5-5',
  dataDir: path.resolve(env.DATA_DIR || './data'),
  tz: env.OFFICE_TZ || 'Asia/Tashkent',
  paperCash: +env.PAPER_START_CASH || 10000,
  maxOrderUsd: +env.MAX_ORDER_USD || 3000,
};
if (!CFG.binance.maxOrderUsd) CFG.binance.maxOrderUsd = CFG.binance.env === 'live' ? 200 : CFG.maxOrderUsd;

export function validateConfig() {
  // только то, без чего офис не может работать вообще; проблемы конкретного счёта показываются в интерфейсе
  const errs = [];
  if (!['paper', 'exchange'].includes(CFG.mode)) errs.push('TRADING_MODE должен быть paper или exchange');
  if (!['bybit', 'binance', 'mock'].includes(CFG.quotes)) errs.push('QUOTES должен быть binance, bybit или mock');
  if (!['swap', 'spot'].includes(CFG.marketType)) errs.push('MARKET_TYPE должен быть swap или spot');
  return errs;
}
// почему счёт Binance нельзя подключить (пустая строка — можно)
export function binanceProblem() {
  const b = CFG.binance;
  if (!['live', 'demo', 'mock'].includes(b.env)) return `BINANCE_ENV=«${b.env}» — нужно live (настоящий счёт) или demo`;
  if (b.env === 'mock') return CFG.quotes === 'mock' ? '' : 'BINANCE_ENV=mock работает только вместе с QUOTES=mock';
  if (!b.key && !b.secret) return 'Не настроен: добавьте BINANCE_API_KEY и BINANCE_API_SECRET в настройки сервера';
  if (!b.key) return 'Не задан BINANCE_API_KEY';
  if (!b.secret) return 'Не задан BINANCE_API_SECRET';
  if (/\s/.test(b.key) || /\s/.test(b.secret)) return 'В ключе или секрете есть пробел или перенос строки — скопируйте их заново без лишних символов';
  if (!CFG.password) return 'Задайте ACCESS_PASSWORD: без пароля любой, кто знает адрес, сможет управлять сделками';
  if (b.env === 'live' && CFG.password.length < 10) return 'Для реального счёта пароль ACCESS_PASSWORD должен быть не короче 10 символов';
  return '';
}
