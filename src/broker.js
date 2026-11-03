// Исполнение ордеров: виртуальный счёт на реальных ценах или биржа (реальный счёт, демо-счёт, тестовая сеть)
import {describeError} from './exchange.js';
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class PaperBroker {
  constructor(){ this.kind = 'paper'; this.fee = 0.0006; this.slip = 0.0003; }
  async init(){}
  async open({dir, qty, price}){ const fill = price * (1 + dir * this.slip); return {fill, qty, fee: fill * qty * this.fee}; }
  async close(pos, price){ const fill = price * (1 - pos.dir * this.slip); return {fill, qty: pos.qty, fee: fill * pos.qty * this.fee}; }
  async balance(){ return null; }
  async openPositions(){ return null; }
  async protectPos(){ return null; }
  async unprotectPos(){}
}

export class ExchangeBroker {
  constructor(ex, CFG, opts = {}){
    this.ex = ex; this.CFG = CFG; this.kind = 'exchange'; this.fee = CFG.marketType === 'swap' ? 0.00055 : 0.001; this.lastBalance = null;
    this.name = opts.name || 'Биржа'; this.live = !!opts.live; this.checkKey = !!opts.checkKey; this.protect = !!opts.protect; this.binance = !!opts.binance;
    this.hedge = false; this.notes = []; this.prepared = new Set();
  }
  async init(symbols){
    this.notes = [];
    if (!this.ex.markets || !Object.keys(this.ex.markets).length) await this.ex.loadMarkets();
    // настоящий счёт: проверяем права ключа — вывод средств должен быть выключен
    if (this.checkKey && this.ex.sapiGetAccountApiRestrictions){
      const r = await this.ex.sapiGetAccountApiRestrictions();
      const on = v => v === true || v === 'true';
      const fail = text => { const e = new Error(text); e.userMessage = text; throw e; };
      if (on(r.enableWithdrawals)) fail('У ключа API включён вывод средств. Создайте ключ без права вывода — офису оно не нужно и опасно.');
      if (this.CFG.marketType === 'swap' && !on(r.enableFutures)) fail('У ключа API нет права на фьючерсы: в настройках ключа включите «Enable Futures».');
      if (this.CFG.marketType === 'spot' && !on(r.enableSpotAndMarginTrading)) fail('У ключа API нет права на спотовую торговлю.');
      if (!on(r.ipRestrict)) this.notes.push('Ключ API работает с любых IP-адресов. Надёжнее ограничить его адресами сервера.');
    }
    if (this.CFG.marketType === 'swap'){
      if (this.binance){
        try { const d = await this.ex.fapiPrivateGetPositionSideDual(); this.hedge = d && (d.dualSidePosition === true || d.dualSidePosition === 'true'); } catch (e) { console.warn('[broker] режим позиций:', describeError(e)); }
      }
    }
    const b = await this.balance(true);
    if (!b) throw new Error('Не удалось получить баланс счёта');
  }
  amount(symbol, qty){
    const a = +this.ex.amountToPrecision(symbol, qty);
    const m = this.ex.market(symbol);
    const minA = m && m.limits && m.limits.amount && m.limits.amount.min;
    if (!(a > 0) || (minA && a < minA)) { const e = new Error(`Объём ${qty} меньше минимального для ${symbol}`); e.code = 'min'; throw e; }
    return a;
  }
  async fill(order, symbol, price){
    let o = order;
    if (!(o && (o.average || (o.price && o.status === 'closed')))){
      await sleep(700);
      try { o = await this.ex.fetchOrder(order.id, symbol); } catch { try { if (this.ex.has && this.ex.has.fetchClosedOrder) o = await this.ex.fetchClosedOrder(order.id, symbol); } catch {} }
    }
    const fill = +(o && (o.average || o.price)) || price;
    const filled = +(o && o.filled) || null;
    const fee = o && o.fee && o.fee.cost && (!o.fee.currency || o.fee.currency === 'USDT') ? +o.fee.cost : null;
    return {fill, filled, fee};
  }
  // плечо и изолированная маржа — только для монет, которыми офис реально торгует, перед первой сделкой
  async prepare(symbol){
    if (this.CFG.marketType !== 'swap' || this.prepared.has(symbol)) return;
    try { await this.ex.setLeverage(this.CFG.leverage, symbol); } catch (e) { if (!/not modified|same|110043|-4028/i.test(e.message)) console.warn('[broker] плечо', symbol, e.message.slice(0, 120)); }
    if (this.binance){ try { await this.ex.setMarginMode('isolated', symbol); } catch (e) { /* уже изолированная маржа или есть позиция */ } }
    this.prepared.add(symbol);
  }
  async open({symbol, dir, qty, price}){
    if (this.CFG.marketType === 'spot' && dir < 0) throw new Error('На споте шорт невозможен');
    await this.prepare(symbol);
    const amount = this.amount(symbol, qty);
    const m = this.ex.market(symbol); const minCost = m && m.limits && m.limits.cost && m.limits.cost.min;
    if (minCost && amount * price < minCost) throw new Error(`Сумма ордера меньше минимальной (${minCost} USDT)`);
    try {
      const params = this.hedge ? {positionSide: dir > 0 ? 'LONG' : 'SHORT'} : {};
      const order = await this.ex.createOrder(symbol, 'market', dir > 0 ? 'buy' : 'sell', amount, price, params);
      const f = await this.fill(order, symbol, price);
      let fill = f.fill;
      if (this.CFG.marketType === 'swap'){ try { const ps = await this.ex.fetchPositions([symbol]); const p = ps.find(x => x.symbol === symbol && +x.contracts > 0); if (p && +p.entryPrice > 0) fill = +p.entryPrice; } catch {} }
      const q = f.filled || amount;
      return {fill, qty: q, fee: f.fee ?? fill * q * this.fee, orderId: order.id};
    } catch (e) { throw new Error(describeError(e)); }
  }
  async close(pos, price){
    const symbol = pos.symbol;
    try {
      let amount = pos.qty;
      if (this.CFG.marketType === 'spot'){
        const b = await this.ex.fetchBalance(); const free = +(b[pos.sym] && b[pos.sym].free) || 0;
        amount = Math.min(amount, free);
      }
      amount = this.amount(symbol, amount);
      const params = this.CFG.marketType !== 'swap' ? {} : this.hedge ? {positionSide: pos.dir > 0 ? 'LONG' : 'SHORT'} : {reduceOnly: true};
      const order = await this.ex.createOrder(symbol, 'market', pos.dir > 0 ? 'sell' : 'buy', amount, price, params);
      const f = await this.fill(order, symbol, price);
      return {fill: f.fill, qty: f.filled || amount, fee: f.fee ?? f.fill * amount * this.fee, orderId: order.id};
    } catch (e) {
      if (e.code === 'min') return {fill: price, qty: pos.qty, fee: 0, note: 'остаток меньше минимального ордера'};
      throw new Error(describeError(e));
    }
  }
  async balance(strict = false){
    try { const b = await this.ex.fetchBalance(); const u = b.USDT || {}; this.lastBalance = {free: +u.free || 0, total: +u.total || 0, ts: Date.now()}; return this.lastBalance; }
    catch (e) { if (strict) throw e; console.warn(`[broker] ${this.name} баланс:`, describeError(e)); return this.lastBalance; }
  }
  // страховочный стоп на бирже: срабатывает, если сервер не успел закрыть позицию сам (выключен, нет связи)
  async protectPos(pos){
    if (!this.protect) return null;
    const px = pos.sl - pos.dir * pos.stop * 0.25;
    const params = {stopLossPrice: +this.ex.priceToPrecision(pos.symbol, px), workingType: 'MARK_PRICE'};
    if (this.hedge) params.positionSide = pos.dir > 0 ? 'LONG' : 'SHORT'; else params.reduceOnly = true;
    const o = await this.ex.createOrder(pos.symbol, 'market', pos.dir > 0 ? 'sell' : 'buy', this.amount(pos.symbol, pos.qty), undefined, params);
    return {id: o.id, price: params.stopLossPrice};
  }
  async unprotectPos(pos){
    if (!pos.protId) return;
    try { await this.ex.cancelOrder(pos.protId, pos.symbol, {trigger: true}); } catch (e) { /* уже сработал или отменён */ }
    pos.protId = null;
  }
  async openPositions(symbols){
    if (this.CFG.marketType !== 'swap') return [];
    try { const ps = await this.ex.fetchPositions(symbols); return ps.filter(p => +p.contracts > 0).map(p => ({symbol: p.symbol, dir: p.side === 'short' ? -1 : 1, qty: +p.contracts, entry: +p.entryPrice})); }
    catch (e) { console.warn('[broker] позиции:', describeError(e)); return null; }
  }
}
