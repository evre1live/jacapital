// Работа над ошибками: раз в день Claude разбирает сделки, называет ошибки и предлагает поправки параметров.
// Поправка применяется автоматически, только если на истории она лучше прежней настройки; через 14 дней её проверяют
// на новых данных, которых не было при решении, и откатывают, если она оказалась хуже.
import fs from 'node:fs';
import path from 'node:path';
import {askJSON, aiEnabled} from './claude.js';
import {PARAM_SPACE, STRATS} from './engine.js';
import {fmtUSD} from './brain.js';

const DAY = 864e5;
const NAMES = {
  trend: {tv: 'целевая волатильность', cap: 'предел размера', shortW: 'вес шортов', band: 'допуск ребалансировки'},
  carry: {enter: 'порог входа (годовых)', exit: 'порог выхода (годовых)', nEnter: 'окно входа (событий)', nExit: 'окно выхода (событий)', lev: 'плечо фьючерса'},
  mr: {entry: 'порог RSI-2', exitMa: 'средняя для выхода (ч)', trendMa: 'средняя тренда (ч)', maxHold: 'макс. удержание (ч)', stopAtr: 'стоп (ATR)'},
  risk: {ddBrake: 'тормоз при просадке', ddStop: 'аварийная остановка'},
};
const PROPOSABLE = {trend: ['tv', 'cap', 'shortW', 'band'], carry: ['enter', 'exit', 'nEnter', 'nExit', 'lev'], mr: ['entry', 'exitMa', 'trendMa', 'maxHold', 'stopAtr'], risk: ['ddBrake', 'ddStop']};
const INT = new Set(['nEnter', 'nExit', 'exitMa', 'trendMa', 'maxHold']);
export const paramName = (s, p) => (NAMES[s] && NAMES[s][p]) || p;

export class Reviewer {
  constructor({office, engine, CFG, validate}){
    this.office = office; this.engine = engine; this.CFG = CFG; this.validate = validate;
    this.file = path.join(CFG.dataDir, 'journal.json'); this.running = false; this.text = '';
    try { this.j = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.j = null; }
    if (!this.j || !Array.isArray(this.j.reviews)) this.j = {reviews: [], changes: []};
  }
  save(){ try { fs.mkdirSync(this.CFG.dataDir, {recursive: true}); fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.j)); fs.renameSync(this.file + '.tmp', this.file); } catch (e) { console.warn('[review] не сохранил журнал:', e.message); } }
  get last(){ return this.j.reviews[0] || null; }
  publicView(){ return {running: this.running, text: this.text, ai: aiEnabled(), reviews: this.j.reviews.slice(0, 12), changes: this.j.changes.slice(0, 40)}; }

  // ---------- что отдаём Claude ----------
  pack(){
    const off = this.office, st = off.state, eng = this.engine, now = Date.now(), r2 = x => Math.round(x * 100) / 100;
    const trades = [];
    for (const [id, book] of Object.entries(st.books)){
      const acc = off.accounts[id]; if (!acc) continue;
      for (const c of book.closed.filter(c => c.tsClose > now - 14 * DAY).slice(0, 60))
        trades.push({account: acc.real ? 'реальный' : 'виртуальный', strategy: c.strategy || 'legacy', coin: c.sym, side: c.kind === 'carry' ? 'спот+шорт' : c.dir > 0 ? 'LONG' : 'SHORT',
          opened: new Date(c.ts).toISOString().slice(0, 16), hold_h: r2((c.tsClose - c.ts) / 36e5), entry: c.entry ? +c.entry.toPrecision(6) : null, exit: c.exit ? +c.exit.toPrecision(6) : null,
          pnl_usd: r2(c.pnl), pnl_pct: r2((c.pct || 0) * 100), fees_usd: c.fees != null ? r2(c.fees) : null, funding_usd: c.funding != null ? r2(c.funding) : null, reason: c.reason, context: c.ctx || null});
    }
    const books = Object.entries(st.books).filter(([id]) => off.accounts[id] && off.accounts[id].ready).map(([id, b]) => {
      const acc = off.accounts[id], cl = b.closed.filter(c => c.tsClose > now - 14 * DAY);
      return {account: acc.label, real: !!acc.real, equity: r2(off.equity(b)), start: r2(b.startEquity), peak: r2(b.peak), max_dd_pct: r2(b.maxDD * 100), fees_total: r2(b.fees),
        trades_14d: cl.length, pnl_14d: r2(cl.reduce((a, c) => a + c.pnl, 0)), fees_14d: r2(cl.reduce((a, c) => a + (c.fees || 0), 0)),
        open: b.positions.map(p => ({strategy: p.strategy || 'legacy', coin: p.sym, side: p.kind === 'carry' ? 'спот+шорт' : p.dir > 0 ? 'LONG' : 'SHORT', usd: r2(p.kind === 'carry' ? p.notional : p.entry * p.qty), upnl: r2(off.upnl(p)), funding: p.funding != null ? r2(p.funding) : undefined, context: p.ctx || null}))};
    });
    const bt = this.btSummary ? this.btSummary() : null;
    const limits = Object.fromEntries(Object.entries(PROPOSABLE).map(([s, ps]) => [s, Object.fromEntries(ps.map(p => [p, {name: paramName(s, p), now: st.strat.params[s][p], min: PARAM_SPACE[s][p][0], max: PARAM_SPACE[s][p][1]}]))]));
    return {now: new Date().toISOString(), books, trades, strategies: {alloc: st.strat.alloc, status: st.strat.status, paper_pnl_since_start: eng.dailyPnl(), testing_since: new Date(st.strat.since).toISOString().slice(0, 10)},
      parameters: limits, backtest: bt, market: eng.publicView ? {trend: eng.publicView().trend, funding_apr_7d: eng.publicView().carry, risk: eng.view ? eng.view.risk : null} : null,
      recent_changes: this.j.changes.slice(0, 12).map(c => ({ts: new Date(c.ts).toISOString().slice(0, 10), strategy: c.strategy, param: c.param, from: c.from, to: c.to, status: c.status, why: c.verdictWhy}))};
  }

  // ---------- ежедневный разбор ----------
  async run(why = 'по расписанию'){
    if (this.running) throw new Error('Разбор уже идёт');
    if (!aiEnabled()){ const e = new Error('Не задан ANTHROPIC_API_KEY'); e.code = 'no_key'; throw e; }
    this.running = true; this.text = 'Claude читает сделки'; this.office.emit('review');
    const t0 = Date.now(), rec = {id: Date.now(), ts: Date.now(), why, model: this.CFG.modelReview, proposals: []};
    try {
      await this.forwardChecks();
      const pack = this.pack();
      const system = `Ты — аналитик-ревизор торгового офиса JA Capital (криптофьючерсы Binance). Твоя задача — честный разбор сделок: найти ошибки и закономерности, оценить их цену в долларах и предложить осторожные поправки параметров.
Правила:
- Опирайся только на данные из JSON; не выдумывай цифры. Если данных мало (меньше 10 сделок стратегии), так и скажи и не предлагай поправок по этой стратегии, кроме снижения риска.
- Разделяй невезение (обычный разброс) и системную ошибку (повторяется, связана с правилом стратегии, комиссиями, размером позиции, временем удержания).
- Прежняя логика агентов (strategy = legacy, 5-минутные сделки) уже выключена как убыточная; её сделки разбирай как уроки, поправок для неё не предлагай.
- Поправки — только из списка parameters, в пределах min…max, не больше трёх, по одной на параметр. Каждая будет автоматически проверена на истории с 2021 года, за последний год и за последние 90 дней и применена, только если улучшит результат; через 14 дней её перепроверят на новых данных и откатят, если она хуже. Поэтому лучше не предлагать ничего, чем предлагать слабое.
- Не повторяй поправки, отклонённые за последние 14 дней (recent_changes).
- Пиши по-русски, коротко и конкретно.
Ответь только JSON:
{"summary":"2–4 предложения: что произошло и почему","mistakes":[{"title":"…","evidence":"цифры из данных","cost_usd":число или null,"lesson":"что делать иначе"}],"proposals":[{"strategy":"trend|carry|mr|risk","param":"…","value":число,"why":"…"}],"watch":["что отслеживать"]}`;
      const d = await askJSON({system, prompt: 'Данные офиса:\n' + JSON.stringify(pack), model: this.CFG.modelReview, maxTokens: 3000, kind: 'review'});
      rec.summary = String(d.summary || '').slice(0, 1200);
      rec.mistakes = (Array.isArray(d.mistakes) ? d.mistakes : []).slice(0, 6).map(m => ({title: String(m.title || '').slice(0, 160), evidence: String(m.evidence || '').slice(0, 400), cost: isFinite(+m.cost_usd) && m.cost_usd !== null ? +m.cost_usd : null, lesson: String(m.lesson || '').slice(0, 300)}));
      rec.watch = (Array.isArray(d.watch) ? d.watch : []).slice(0, 4).map(x => String(x).slice(0, 200));
      const props = (Array.isArray(d.proposals) ? d.proposals : []).slice(0, 3);
      this.text = props.length ? `проверяю поправки на истории (${props.length})` : 'готово'; this.office.emit('review');
      for (const p of props) rec.proposals.push(await this.consider(p));
      rec.took = Math.round((Date.now() - t0) / 1000);
      this.j.reviews.unshift(rec); this.j.reviews.length = Math.min(this.j.reviews.length, 60);
      this.announce(rec);
      return rec;
    } catch (e) {
      rec.error = e.message; this.j.reviews.unshift(rec); this.j.reviews.length = Math.min(this.j.reviews.length, 60);
      console.warn('[review] ошибка:', e.message); throw e;
    } finally { this.running = false; this.text = ''; this.save(); this.office.emit('review'); }
  }

  // проверка одной поправки: границы, частота, история; применение при успехе
  async consider(p){
    const st = this.office.state, s = String(p.strategy || ''), k = String(p.param || ''), now = Date.now();
    const out = {strategy: s, param: k, name: paramName(s, k), value: +p.value, why: String(p.why || '').slice(0, 400), verdict: 'rejected', verdictWhy: ''};
    if (!PROPOSABLE[s] || !PROPOSABLE[s].includes(k)) { out.verdictWhy = 'такого параметра нет в списке допустимых'; return out; }
    const [lo, hi] = PARAM_SPACE[s][k]; let v = +p.value; if (!isFinite(v)) { out.verdictWhy = 'значение не число'; return out; }
    v = Math.max(lo, Math.min(hi, v)); if (INT.has(k)) v = Math.round(v); out.value = v;
    const cur = st.strat.params[s][k]; out.from = cur;
    if (v === cur) { out.verdictWhy = 'совпадает с текущим значением'; return out; }
    if (s === 'risk' && k === 'ddStop' && v <= st.strat.params.risk.ddBrake) { out.verdictWhy = 'аварийный порог должен быть выше тормоза'; return out; }
    if (this.j.changes.some(c => c.strategy === s && c.param === k && now - c.ts < 7 * DAY && c.status !== 'rejected')) { out.verdictWhy = 'этот параметр меняли меньше недели назад'; return out; }
    if (this.j.changes.some(c => c.strategy === s && c.param === k && c.to === v && c.status === 'rejected' && now - c.ts < 14 * DAY)) { out.verdictWhy = 'такую поправку уже отклоняли за последние 14 дней'; return out; }
    const base = {...st.strat.params[s]}, cand = {...base, [k]: v};
    let rep;
    try { rep = await this.validate(s, base, cand, [{id: 'full', title: 'с 2021', from: Date.UTC(2021, 0, 1), to: Infinity}, {id: 'y1', title: 'за год', from: now - 365 * DAY, to: Infinity}, {id: 'q', title: 'за 90 дней', from: now - 90 * DAY, to: Infinity}]); }
    catch (e) { out.verdictWhy = 'проверка не удалась: ' + e.message; return out; }
    out.report = rep.windows.map(w => ({id: w.id, title: w.title, base: brief(w.base), cand: brief(w.cand)}));
    const [full, y1, q] = rep.windows, better = w => w.base && w.cand && (w.cand.sharpe > w.base.sharpe + 0.02 || (Math.abs(w.cand.sharpe - w.base.sharpe) <= 0.02 && w.cand.total > w.base.total + 0.002));
    const reasons = [];
    if (!better(full)) reasons.push('с 2021 года не лучше');
    if (!better(y1) && !better(q)) reasons.push('за последний год и 90 дней не лучше');
    if (full.base && full.cand && full.cand.mdd > full.base.mdd + 0.02) reasons.push(`просадка больше на ${((full.cand.mdd - full.base.mdd) * 100).toFixed(1)} п.п.`);
    if (y1.base && y1.cand && y1.cand.total < y1.base.total - 0.01) reasons.push('за год доходность ниже');
    const change = {id: now + Math.random(), ts: now, strategy: s, param: k, name: out.name, from: cur, to: v, why: out.why, report: out.report};
    if (reasons.length){ out.verdictWhy = reasons.join('; '); this.j.changes.unshift({...change, status: 'rejected', verdictWhy: out.verdictWhy}); return out; }
    // применяем: поправка прошла проверку на истории
    st.strat.params[s][k] = v; out.verdict = 'applied';
    out.verdictWhy = `лучше на истории: Шарп с 2021 ${full.base.sharpe.toFixed(2)} → ${full.cand.sharpe.toFixed(2)}, за год ${y1.base ? y1.base.sharpe.toFixed(2) : '—'} → ${y1.cand ? y1.cand.sharpe.toFixed(2) : '—'}`;
    this.j.changes.unshift({...change, status: 'applied', verdictWhy: out.verdictWhy, checkAt: now + 14 * DAY});
    if (s === 'trend' && this.onTrendChange) this.onTrendChange();
    this.office.touch();
    return out;
  }

  // через 14 дней: поправка против прежнего значения на данных после её применения
  async forwardChecks(){
    const st = this.office.state, now = Date.now();
    for (const c of this.j.changes.filter(c => c.status === 'applied' && c.checkAt <= now)){
      const base = {...st.strat.params[c.strategy], [c.param]: c.from}, cand = {...st.strat.params[c.strategy], [c.param]: c.to};
      let rep; try { rep = await this.validate(c.strategy, base, cand, [{id: 'fwd', title: 'после применения', from: c.ts, to: Infinity}]); } catch (e) { console.warn('[review] перепроверка:', e.message); continue; }
      const w = rep.windows[0]; c.forward = {base: brief(w.base), cand: brief(w.cand), ts: now};
      const worse = w.base && w.cand && (w.cand.total < w.base.total - 0.005 || w.cand.sharpe < w.base.sharpe - 0.3);
      if (worse && st.strat.params[c.strategy][c.param] === c.to){
        st.strat.params[c.strategy][c.param] = c.from; c.status = 'rolled_back';
        this.office.post('timur', null, `Откат поправки: «${c.name}» (${STRATS[c.strategy] ? STRATS[c.strategy].name : 'риск'}) возвращён ${c.from} вместо ${c.to} — на новых данных она хуже: ${pctS(w.cand.total)} против ${pctS(w.base.total)}.`, 'system');
        if (c.strategy === 'trend' && this.onTrendChange) this.onTrendChange();
      } else { c.status = 'confirmed'; this.office.post('timur', null, `Поправка «${c.name}» подтверждена на новых данных: ${w.cand ? pctS(w.cand.total) : '—'} против ${w.base ? pctS(w.base.total) : '—'} у прежней настройки.`, 'system'); }
    }
    this.save();
  }

  announce(rec){
    const off = this.office;
    off.post('system', null, `Работа над ошибками: ${rec.summary}`, 'meet');
    for (const m of rec.mistakes.slice(0, 3)) off.post('boris', null, `Ошибка: ${m.title}. ${m.evidence}${m.cost != null ? ` Цена: ${fmtUSD(-Math.abs(m.cost))}.` : ''} Урок: ${m.lesson}`, 'meet');
    for (const p of rec.proposals){
      const w = STRATS[p.strategy] ? STRATS[p.strategy].name : 'риск';
      off.post('timur', null, p.verdict === 'applied' ? `Поправка принята (${w}): «${p.name}» ${p.from} → ${p.value}. ${p.verdictWhy}.` : `Поправка отклонена (${w}): «${p.name}» ${p.from != null ? p.from + ' → ' : ''}${p.value} — ${p.verdictWhy}.`, 'meet');
    }
    off.emit('run', {id: off.ctx.id(), ts: Date.now(), news: false, stages: [{agent: 'boris', say: 'Разбор ошибок'}, {agent: 'timur', say: rec.proposals.some(p => p.verdict === 'applied') ? 'Поправка принята' : 'Без поправок'}]});
    off.touch();
  }
}
function brief(m){ return m ? {total: round4(m.total), sharpe: round2(m.sharpe), mdd: round4(m.mdd), posMonths: m.posMonths != null ? round2(m.posMonths) : null} : null; }
const round2 = x => Math.round(x * 100) / 100, round4 = x => Math.round(x * 1e4) / 1e4;
const pctS = x => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1).replace('.', ',') + '%';
