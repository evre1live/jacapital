// Подключение к бирже через ccxt: котировки и (в режиме exchange) ордера на демо-счёте / тестовой сети
import ccxt from 'ccxt';
import {MockExchange} from './mockexchange.js';

export function makeExchanges(CFG) {
  const opts = {enableRateLimit: true, timeout: 15000, options: {defaultType: CFG.marketType === 'swap' ? 'swap' : 'spot'}};
  if (CFG.exchange === 'mock') { const m = new MockExchange(CFG); return {data: m, trade: CFG.mode === 'exchange' ? m : null}; }
  const Cls = ccxt[CFG.exchange];
  let trade = null;
  if (CFG.mode === 'exchange') {
    trade = new Cls({...opts, apiKey: CFG.apiKey, secret: CFG.apiSecret});
    if (CFG.exchangeEnv === 'testnet') trade.setSandboxMode(true);
    else trade.enableDemoTrading(true);
  }
  // котировки: демо-торговля идёт по реальным ценам основной биржи, тестовая сеть — по своим
  const data = (trade && CFG.exchangeEnv === 'testnet') ? trade : new Cls(opts);
  return {data, trade};
}

export function symbolFor(base, marketType) { return marketType === 'swap' ? `${base}/USDT:USDT` : `${base}/USDT`; }

export function describeError(e) {
  const msg = String(e && (e.message || e)).slice(0, 300);
  if (/451|restricted location|not available in your region|CloudFront/i.test(msg)) return 'Биржа недоступна из региона сервера (код 451). Разверните сервер во Франкфурте или Сингапуре.';
  if (e instanceof ccxt.AuthenticationError || /api key|invalid key|signature|10003|10004|-2015|-2014/i.test(msg)) return 'Биржа отклонила ключи API. Проверьте, что ключи созданы для демо-счёта или тестовой сети и у них есть право на торговлю.';
  if (e instanceof ccxt.InsufficientFunds) return 'Недостаточно средств на счёте биржи.';
  if (e instanceof ccxt.NetworkError || e instanceof ccxt.RequestTimeout) return 'Нет связи с биржей: ' + msg.slice(0, 120);
  return msg;
}
