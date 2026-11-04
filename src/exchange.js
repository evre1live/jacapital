// Подключение к биржам через ccxt: котировки (публичные данные) и счета, на которых можно торговать
import ccxt from 'ccxt';
import {MockExchange} from './mockexchange.js';
import {PaperBroker, ExchangeBroker} from './broker.js';
import {binanceProblem} from './config.js';

const cap = s => s[0].toUpperCase() + s.slice(1);

// Котировки: одна биржа для всех счетов. Демо-торговля Binance и Bybit идёт по ценам основной биржи.
export function makeData(CFG) {
  if (CFG.quotes === 'mock') return new MockExchange(CFG);
  const only = CFG.quotes === 'binance' ? {fetchMarkets: CFG.marketType === 'swap' ? ['linear'] : ['spot']} : {};
  return new ccxt[CFG.quotes]({enableRateLimit: true, timeout: 15000, options: {defaultType: CFG.marketType === 'swap' ? 'swap' : 'spot', ...only}});
}

// Счета: виртуальный — всегда; Binance — если заданы ключи; старая настройка EXCHANGE + EXCHANGE_API_KEY (Bybit) — тоже.
export function makeAccounts(CFG, data) {
  const opts = {enableRateLimit: true, timeout: 15000, options: {defaultType: CFG.marketType === 'swap' ? 'swap' : 'spot'}};
  const market = CFG.marketType === 'swap' ? 'фьючерсы' : 'спот';
  const list = [];
  list.push({id: 'paper', kind: 'paper', real: false, label: 'Виртуальный счёт', note: `$${CFG.paperCash.toLocaleString('ru-RU')} ненастоящих денег, реальные котировки ${cap(CFG.quotes === 'mock' ? 'имитации' : CFG.quotes)}`,
    sig: 'paper', broker: new PaperBroker(), ready: true, configured: true, maxOrderUsd: CFG.maxOrderUsd});

  const b = CFG.binance;
  const problem = binanceProblem();
  const bOk = !problem;
  const bLabel = b.env === 'live' ? 'Binance — реальный счёт' : b.env === 'demo' ? 'Binance — демо-счёт' : 'Binance — имитация';
  const acc = {id: 'binance', kind: 'exchange', real: b.env === 'live', label: bLabel, note: `${market}, плечо ${CFG.leverage}×, ордер до $${b.maxOrderUsd}`,
    sig: `binance:${b.env}:${CFG.marketType}`, configured: !!bOk, ready: false, maxOrderUsd: b.maxOrderUsd, minTradeUsd: 5,
    error: bOk ? 'Подключаюсь…' : problem};
  if (bOk){
    let ex;
    if (b.env === 'mock') ex = data instanceof MockExchange ? data : new MockExchange(CFG);
    else {
      // сверка часов с Binance, запас по времени запроса, только нужные рынки (без COIN-M и опционов)
      ex = new ccxt.binance({...opts, apiKey: b.key, secret: b.secret, options: {...opts.options, adjustForTimeDifference: true, recvWindow: 10000, fetchMarkets: CFG.marketType === 'swap' ? ['linear'] : ['spot']}});
      if (b.env === 'demo') ex.enableDemoTrading(true);
      if (b.proxy) ex.httpsProxy = b.proxy;
    }
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

let SERVER_IP = '', VIA_PROXY = false;
export function setServerIp(ip, viaProxy = false){ SERVER_IP = ip || ''; VIA_PROXY = viaProxy; }
export const maskProxy = u => { try { const x = new URL(u); return `${x.protocol}//${x.host}`; } catch { return 'задан'; } };
export function describeError(e) {
  const msg = String(e && (e.message || e)).slice(0, 400);
  if (e && e.userMessage) return e.userMessage;
  const raw = (msg.match(/"code":\s*(-?\d+)[^}]*"msg":\s*"([^"]+)"/) || []);
  const tail = raw[1] ? ` (Binance ${raw[1]}: ${raw[2]})` : '';
  const ip = VIA_PROXY ? (SERVER_IP ? ` Запросы идут через прокси, его IP: ${SERVER_IP}.` : '') : (SERVER_IP ? ` IP сервера сейчас: ${SERVER_IP}, но на Render он меняется — для белого списка нужен прокси со статическим IP (BINANCE_PROXY).` : '');
  if (/451|restricted location|not available in your region|CloudFront|Service unavailable from a restricted/i.test(msg)) return 'Биржа недоступна из региона сервера (код 451). Сервер должен быть во Франкфурте или Сингапуре, не в США.' + tail;
  if (/-2015|Invalid API-key, IP, or permissions/i.test(msg)) return `Binance не принял ключ: неверный ключ, адрес сервера не в списке разрешённых IP или у ключа нет нужных прав (чтение и «Enable Futures»).${ip} Проверьте список IP у ключа.` + tail;
  if (/-2014|API-key format invalid/i.test(msg)) return 'Неверный формат BINANCE_API_KEY: скопируйте ключ заново, целиком и без пробелов.' + tail;
  if (/-2008|Invalid Api-Key ID/i.test(msg)) return 'Такого ключа нет на этом счёте. Ключ от демо-счёта не работает на реальном и наоборот — проверьте BINANCE_ENV (live или demo).' + tail;
  if (/-1022|Signature for this request is not valid/i.test(msg)) return 'Неверный BINANCE_API_SECRET: секрет не подходит к ключу. Скопируйте его заново (Binance показывает секрет только при создании ключа).' + tail;
  if (/-1021|recvWindow|ahead of the server|Timestamp for this request/i.test(msg)) return 'Часы сервера расходятся с Binance. Повторю запрос с поправкой времени.' + tail;
  if (/-4061|position side does not match/i.test(msg)) return 'Режим позиций Binance (хедж/односторонний) не совпал. Переподключите счёт — офис определит режим заново.' + tail;
  if (/-2019|margin is insufficient/i.test(msg) || e instanceof ccxt.InsufficientFunds) return 'Недостаточно средств на фьючерсном счёте Binance: переведите USDT со спотового кошелька на USDⓈ-M фьючерсы.' + tail;
  if (/-4164|notional must be no smaller/i.test(msg)) return 'Сумма ордера меньше минимальной для этой монеты на Binance. Увеличьте BINANCE_MAX_ORDER_USD.' + tail;
  if (/api key|invalid key|signature|10003|10004/i.test(msg) || e instanceof ccxt.AuthenticationError) return 'Биржа отклонила ключи API. Проверьте ключ, секрет и права (чтение и торговля).' + tail;
  if (e instanceof ccxt.NetworkError || e instanceof ccxt.RequestTimeout) return 'Нет связи с биржей: ' + msg.slice(0, 160);
  return msg;
}
