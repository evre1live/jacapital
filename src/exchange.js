// Подключение к биржам через ccxt: котировки (публичные данные) и счета, на которых можно торговать
import ccxt from 'ccxt';
import {MockExchange} from './mockexchange.js';
import {PaperBroker, ExchangeBroker} from './broker.js';

const cap = s => s[0].toUpperCase() + s.slice(1);

// Котировки: одна биржа для всех счетов. Демо-торговля Binance и Bybit идёт по ценам основной биржи.
export function makeData(CFG) {
  if (CFG.quotes === 'mock') return new MockExchange(CFG);
  return new ccxt[CFG.quotes]({enableRateLimit: true, timeout: 15000, options: {defaultType: CFG.marketType === 'swap' ? 'swap' : 'spot'}});
}

// Счета: виртуальный — всегда; Binance — если заданы ключи; старая настройка EXCHANGE + EXCHANGE_API_KEY (Bybit) — тоже.
export function makeAccounts(CFG, data) {
  const opts = {enableRateLimit: true, timeout: 15000, options: {defaultType: CFG.marketType === 'swap' ? 'swap' : 'spot'}};
  const market = CFG.marketType === 'swap' ? 'фьючерсы' : 'спот';
  const list = [];
  list.push({id: 'paper', kind: 'paper', real: false, label: 'Виртуальный счёт', note: `$${CFG.paperCash.toLocaleString('ru-RU')} ненастоящих денег, реальные котировки ${cap(CFG.quotes === 'mock' ? 'имитации' : CFG.quotes)}`,
    sig: 'paper', broker: new PaperBroker(), ready: true, configured: true, maxOrderUsd: CFG.maxOrderUsd});

  const b = CFG.binance;
  const bOk = b.env === 'mock' || (b.key && b.secret);
  const bLabel = b.env === 'live' ? 'Binance — реальный счёт' : b.env === 'demo' ? 'Binance — демо-счёт' : 'Binance — имитация';
  const acc = {id: 'binance', kind: 'exchange', real: b.env === 'live', label: bLabel, note: `${market}, плечо ${CFG.leverage}×, ордер до $${b.maxOrderUsd}`,
    sig: `binance:${b.env}:${CFG.marketType}`, configured: !!bOk, ready: false, maxOrderUsd: b.maxOrderUsd,
    error: bOk ? 'Подключаюсь…' : 'Не настроен: добавьте BINANCE_API_KEY и BINANCE_API_SECRET в настройки сервера'};
  if (bOk){
    let ex;
    if (b.env === 'mock') ex = data instanceof MockExchange ? data : new MockExchange(CFG);
    else { ex = new ccxt.binance({...opts, apiKey: b.key, secret: b.secret}); if (b.env === 'demo') ex.enableDemoTrading(true); }
    acc.broker = new ExchangeBroker(ex, CFG, {name: 'Binance', live: b.env === 'live', checkKey: b.env === 'live', protect: b.env !== 'mock' && CFG.marketType === 'swap', binance: b.env !== 'mock'});
  }
  list.push(acc);

  // старая настройка: TRADING_MODE=exchange + EXCHANGE=bybit|mock + ключи
  if (CFG.exchange !== 'binance' && ((CFG.apiKey && CFG.apiSecret && CFG.exchange === 'bybit') || (CFG.mode === 'exchange' && CFG.exchange === 'mock'))){
    const id = CFG.exchange;
    let ex;
    if (id === 'mock') ex = data instanceof MockExchange ? data : new MockExchange(CFG);
    else { ex = new ccxt.bybit({...opts, apiKey: CFG.apiKey, secret: CFG.apiSecret}); if (CFG.exchangeEnv === 'testnet') ex.setSandboxMode(true); else ex.enableDemoTrading(true); }
    list.push({id, kind: 'exchange', real: false, label: id === 'mock' ? 'Имитация биржи' : `Bybit — ${CFG.exchangeEnv === 'testnet' ? 'тестовая сеть' : 'демо-счёт'}`, note: market,
      sig: `${id}:${CFG.exchangeEnv}:${CFG.marketType}`, configured: true, ready: false, error: 'Подключаюсь…', maxOrderUsd: CFG.maxOrderUsd,
      broker: new ExchangeBroker(ex, CFG, {name: id === 'mock' ? 'Имитация' : 'Bybit'})});
  }
  return Object.fromEntries(list.map(a => [a.id, a]));
}

export function symbolFor(base, marketType) { return marketType === 'swap' ? `${base}/USDT:USDT` : `${base}/USDT`; }

export function describeError(e) {
  const msg = String(e && (e.message || e)).slice(0, 300);
  if (e && e.userMessage) return e.userMessage;
  if (/451|restricted location|not available in your region|CloudFront/i.test(msg)) return 'Биржа недоступна из региона сервера (код 451). Разверните сервер во Франкфурте или Сингапуре.';
  if (/-2015|-2014|-1022|api key|invalid key|signature|10003|10004/i.test(msg) || e instanceof ccxt.AuthenticationError) return 'Биржа отклонила ключи API. Проверьте, что ключ скопирован целиком, у него есть право на торговлю и, если включён список IP, в нём есть адрес сервера.';
  if (e instanceof ccxt.InsufficientFunds || /-2019|margin is insufficient/i.test(msg)) return 'Недостаточно средств на счёте биржи.';
  if (e instanceof ccxt.NetworkError || e instanceof ccxt.RequestTimeout) return 'Нет связи с биржей: ' + msg.slice(0, 120);
  return msg;
}
