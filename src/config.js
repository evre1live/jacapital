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
export const CFG = {
  port: +env.PORT || 3000,
  password,
  secret: env.SESSION_SECRET || crypto.createHash('sha256').update('jacapital:' + password).digest('hex'),
  mode: (env.TRADING_MODE || 'paper').toLowerCase(),           // paper | exchange
  exchange: (env.EXCHANGE || 'bybit').toLowerCase(),            // bybit | binance | mock
  exchangeEnv: (env.EXCHANGE_ENV || 'demo').toLowerCase(),      // demo | testnet
  marketType: (env.MARKET_TYPE || 'swap').toLowerCase(),        // swap | spot
  apiKey: env.EXCHANGE_API_KEY || '',
  apiSecret: env.EXCHANGE_API_SECRET || '',
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

export function validateConfig() {
  const errs = [];
  if (!['paper', 'exchange'].includes(CFG.mode)) errs.push('TRADING_MODE должен быть paper или exchange');
  if (!['bybit', 'binance', 'mock'].includes(CFG.exchange)) errs.push('EXCHANGE должен быть bybit, binance или mock');
  if (!['swap', 'spot'].includes(CFG.marketType)) errs.push('MARKET_TYPE должен быть swap или spot');
  if (CFG.mode === 'exchange') {
    if (!['demo', 'testnet'].includes(CFG.exchangeEnv)) errs.push('EXCHANGE_ENV должен быть demo или testnet — торговля реальными деньгами в этой версии выключена');
    if (CFG.exchange === 'binance' && CFG.exchangeEnv === 'testnet' && CFG.marketType === 'swap') errs.push('У Binance больше нет тестовой сети фьючерсов: используйте EXCHANGE_ENV=demo');
    if (CFG.exchange !== 'mock' && (!CFG.apiKey || !CFG.apiSecret)) errs.push('Нужны EXCHANGE_API_KEY и EXCHANGE_API_SECRET от демо-счёта или тестовой сети');
    if (!CFG.password) errs.push('Задайте ACCESS_PASSWORD: без пароля любой, кто знает адрес, сможет управлять сделками');
  }
  return errs;
}
