// Имитация биржи для проверки без интернета и ключей: EXCHANGE=mock
const P0 = {BTC: 77800, ETH: 2480, SOL: 118.4, BNB: 612, XRP: 1.224, DOGE: 0.1618};
const VOL = {BTC: 0.0016, ETH: 0.002, SOL: 0.0028, BNB: 0.0018, XRP: 0.0025, DOGE: 0.0034}; // за минуту
function gauss(){ let u=0,v=0; while(!u) u=Math.random(); while(!v) v=Math.random(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }
export function tfMs(tf){ const m = String(tf).match(/^(\d+)([mhd])$/); if (!m) return 300000; return +m[1] * ({m:60000, h:3600000, d:86400000})[m[2]]; }

export class MockExchange {
  constructor(CFG){
    this.id = 'mock'; this.CFG = CFG; this.markets = {}; this.series = {}; this.balance = 10000; this.orders = {}; this.pos = {}; this.n = 1;
    this.tf = tfMs(CFG.timeframe); this.boost = +process.env.MOCK_VOL || 1;
  }
  async loadMarkets(){
    for (const b of this.CFG.coins){
      const sym = this.CFG.marketType === 'swap' ? `${b}/USDT:USDT` : `${b}/USDT`;
      const p0 = P0[b] || 10;
      this.markets[sym] = {symbol: sym, base: b, quote: 'USDT', type: this.CFG.marketType, active: true, precision: {amount: p0 > 1000 ? 0.001 : p0 > 50 ? 0.01 : p0 > 1 ? 0.1 : 1}, limits: {amount: {min: p0 > 1000 ? 0.001 : 0.01}, cost: {min: 5}}};
      // история
      const now = Date.now(), t0 = Math.floor(now/this.tf)*this.tf; const n = 400; const arr = []; let p = p0;
      const v = (VOL[b] || 0.003) * Math.sqrt(this.tf/60000) * this.boost;
      for (let i=n; i>=1; i--){ const o = p; const c = o*Math.exp(gauss()*v + Math.sin(i/40)*v*0.25); const h = Math.max(o,c)*(1+Math.abs(gauss())*v*0.4), l = Math.min(o,c)*(1-Math.abs(gauss())*v*0.4); arr.push([t0 - i*this.tf, o, h, l, c, 100+Math.random()*900]); p = c; }
      arr.push([t0, p, p, p, p, 0]);
      this.series[sym] = {arr, price: p, last: now, b};
    }
    return this.markets;
  }
  market(s){ return this.markets[s]; }
  amountToPrecision(s, a){ const st = this.markets[s].precision.amount; return String(Math.floor(a/st)*st); }
  step(sym){
    const s = this.series[sym]; const now = Date.now(); const dtMin = (now - s.last)/60000; if (dtMin <= 0) return s.price; s.last = now;
    s.price *= Math.exp(gauss()*(VOL[s.b]||0.003)*Math.sqrt(dtMin)*this.boost);
    let cur = s.arr[s.arr.length-1];
    const t = Math.floor(now/this.tf)*this.tf;
    if (t > cur[0]){ s.arr.push([t, cur[4], cur[4], cur[4], cur[4], 0]); cur = s.arr[s.arr.length-1]; if (s.arr.length > 1000) s.arr.shift(); }
    cur[4] = s.price; cur[2] = Math.max(cur[2], s.price); cur[3] = Math.min(cur[3], s.price); cur[5] += Math.random()*20;
    return s.price;
  }
  async fetchTickers(symbols){
    const out = {};
    for (const sym of symbols){ const p = this.step(sym); const arr = this.series[sym].arr; const ref = arr[Math.max(0, arr.length - Math.round(86400000/this.tf))][1]; out[sym] = {symbol: sym, last: p, close: p, percentage: (p/ref-1)*100, timestamp: Date.now()}; }
    return out;
  }
  async fetchOHLCV(sym, tf, since, limit=300){ this.step(sym); return this.series[sym].arr.slice(-limit).map(r=>[...r]); }
  async setLeverage(){ return true; }
  async fetchBalance(){ let used = 0; for (const k in this.pos) used += Math.abs(this.pos[k].qty)*this.pos[k].entry; return {USDT: {free: this.balance - used, used, total: this.balance}}; }
  async createOrder(sym, type, side, amount, price, params={}){
    const p = this.step(sym) * (side==='buy' ? 1.0003 : 0.9997); const q = +amount; const id = 'm'+(this.n++);
    const fee = p*q*0.0006; this.balance -= fee;
    const cur = this.pos[sym] || {qty: 0, entry: p};
    const signed = side==='buy' ? q : -q;
    if (cur.qty && Math.sign(cur.qty) !== Math.sign(signed)){ const closeQ = Math.min(Math.abs(cur.qty), q); this.balance += (p - cur.entry) * closeQ * Math.sign(cur.qty); }
    const nq = cur.qty + signed; this.pos[sym] = {qty: Math.abs(nq) < 1e-12 ? 0 : nq, entry: Math.sign(nq)===Math.sign(cur.qty) && cur.qty ? cur.entry : p};
    if (!this.pos[sym].qty) delete this.pos[sym];
    const o = {id, symbol: sym, type, side, amount: q, filled: q, average: p, price: p, status: 'closed', fee: {cost: fee, currency: 'USDT'}};
    this.orders[id] = o; return o;
  }
  async fetchOrder(id){ return this.orders[id]; }
  async fetchPositions(symbols){ return Object.entries(this.pos).filter(([s])=>!symbols || symbols.includes(s)).map(([s,v])=>({symbol: s, contracts: Math.abs(v.qty), side: v.qty>0?'long':'short', entryPrice: v.entry})); }
}
