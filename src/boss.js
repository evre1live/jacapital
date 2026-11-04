// Руководитель офиса — Джама. Главная задача: контролировать работу агентов, проводить планёрки, обсуждать стратегии и улучшать показатели.
// - Контроль: каждые 5 минут проверяет зону каждого агента (данные, риск, стратегии, исполнение). Если проблема держится дольше 4 минут —
//   идёт к столу агента с замечанием и поручением; когда проблема уходит — отмечает это.
// - Показатели: капитал, просадка, результат за 7 и 30 дней, комиссии к прибыли — против целей офиса.
// - Планёрки: каждое утро в 10:00 по Ташкенту и внепланово, если что-то пошло не так (не чаще раза в 3 часа и не больше 3 в день).
//   Джама открывает, агенты докладывают, Джама подводит итог, принимает решения и раздаёт поручения; прошлые поручения проверяет.
//   Поправки параметров стратегий с планёрки идут через ту же проверку на истории, что и ежедневный разбор, и через 14 дней перепроверяются.
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {ask, parseJSON, aiEnabled} from './claude.js';
import {fmtUSD} from './brain.js';

const MIN = 60e3, H = 36e5, DAY = 864e5;
const TEAM = ['nika', 'boris', 'timur', 'aliya'];
const NAME = {nika: 'Рустам', boris: 'Аки', timur: 'Нод', aliya: 'Артур', boss: 'Джама'};
const ZONE = {nika: 'данные рынка и новости', boris: 'риск', timur: 'стратегии и сигналы', aliya: 'исполнение и счета'};
const LV = {ok: 0, warn: 1, bad: 2};
const pctS = (x, d = 1) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d).replace('.', ',') + '%';
const pctA = (x, d = 1) => Math.abs(x * 100).toFixed(d).replace('.', ',') + '%';
const r2 = x => Math.round(x * 100) / 100;
const dayStr = t => new Date(t).toISOString().slice(0, 10);
const plural = (n, one, few, many) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many; };
const nIssues = n => n === 1 ? 'одно замечание' : `${n} ${plural(n, 'замечание', 'замечания', 'замечаний')}`;
const dot = s => /[.!?…]$/.test(s) ? s : s + '.';
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/[\s,.;:—-]+\S*$/, '') + '…' : s; };

export class Boss extends EventEmitter {
  constructor({office, engine, market, reviewer, CFG, btSummary}){
    super(); Object.assign(this, {office, engine, market, reviewer, CFG, btSummary});
    this.file = path.join(CFG.dataDir, 'boss.json');
    let j = null; try { j = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    this.j = Object.assign({meetings: [], tasks: [], open: {}, days: [], focus: [], last: {}}, j || {});
    this.checks = []; this.kpi = []; this.seen = {}; this.running = false; this.started = Date.now(); this.lastCheck = 0; this.trigger = null;
    this.lastRound = Date.now(); this.roundK = 0;
  }
  save(){ try { fs.mkdirSync(this.CFG.dataDir, {recursive: true}); fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.j)); fs.renameSync(this.file + '.tmp', this.file); } catch (e) { console.warn('[boss] не сохранил журнал:', e.message); } }
  update(){ clearTimeout(this.upT); this.upT = setTimeout(() => this.emit('update'), 300); }

  // ---------- счета, которые ведёт офис ----------
  books(){
    const off = this.office;
    return Object.values(off.accounts).filter(a => a.ready && off.state.books[a.id] && (a.kind === 'paper' || a.real)).map(a => ({id: a.id, acc: a, book: off.state.books[a.id], eq: off.equity(off.state.books[a.id])}));
  }

  // ---------- контроль: проверка зоны каждого агента ----------
  inspect(){
    const off = this.office, st = off.state, eng = this.engine, now = Date.now(), out = [];
    const add = (agent, code, level, text, task) => out.push({agent, code, level, text, task: task || ''});
    // Рустам: котировки, история свечей, новости
    const ms = this.market.status || {}, age = ms.lastOk ? (now - ms.lastOk) / MIN : Infinity;
    if (!ms.ok || age > 3) add('nika', 'quotes', 'bad', `котировки Binance не обновляются${isFinite(age) ? ` ${Math.round(age)} мин` : ''}${ms.error ? `: ${clip(ms.error, 120)}` : ''}`, 'восстановить поток котировок');
    else add('nika', 'quotes', 'ok', `котировки идут по ${Object.keys(this.market.coins).length} монетам`);
    if (!eng.ok) add('nika', 'history', 'bad', `история свечей не загружена${eng.err ? `: ${clip(eng.err, 120)}` : ''}`, 'загрузить дневную историю для стратегий');
    else {
      const dayBar = Math.floor(now / DAY) * DAY - DAY, late = now - (dayBar + DAY);
      if (eng.st.last && eng.st.last.day !== dayBar && late > 30 * MIN) add('nika', 'daily', 'warn', `дневная свеча ${dayStr(dayBar)} не обработана`, 'обработать закрытие дня');
      else add('nika', 'daily', 'ok', 'дневная свеча обработана вовремя');
    }
    const n0 = st.news && st.news[0], nAge = n0 ? (now - n0.ts) / H : Infinity;
    if (nAge > 8) add('nika', 'news', 'warn', isFinite(nAge) ? `новостей нет ${Math.round(nAge)} ч` : 'новостей пока нет', 'проверить новостные ленты');
    else add('nika', 'news', 'ok', `последняя новость ${nAge < 1 ? `${Math.max(1, Math.round(nAge * 60))} мин` : `${Math.round(nAge)} ч`} назад`);
    // Аки: просадка, остановки, нагрузка на капитал
    const R = eng.P.risk, halt = eng.st.halt || {};
    for (const b of this.books()){
      const dd = b.book.peak > 0 ? Math.max(0, 1 - b.eq / b.book.peak) : 0, tag = b.acc.real ? 'реальный счёт' : 'виртуальный счёт';
      if (halt[b.id]) add('boris', 'dd:' + b.id, 'bad', `${tag}: аварийная остановка, просадка ${pctA(dd)} — позиции закрыты на 14 дней`, 'держать позиции закрытыми до конца паузы и разобрать причину');
      else if (dd >= R.ddBrake) add('boris', 'dd:' + b.id, 'warn', `${tag}: просадка ${pctA(dd)} от пика (тормоз с ${pctA(R.ddBrake, 0)}) — размеры вдвое меньше`, 'проверить, что размеры уменьшены, и следить за порогом аварийной остановки');
      else add('boris', 'dd:' + b.id, 'ok', `${tag}: просадка ${pctA(dd)} при тормозе ${pctA(R.ddBrake, 0)}`);
      const gross = b.book.positions.reduce((a, p) => a + (p.kind === 'carry' ? p.notional || 0 : Math.abs(p.entry * p.qty)), 0) / Math.max(1e-9, b.eq);
      if (b.acc.real && gross > 1.15) add('boris', 'gross:' + b.id, 'warn', `${tag}: позиции на ${pctA(gross, 0)} капитала — больше, чем без плеча`, 'вернуть нагрузку в пределы капитала');
      if (b.book.killed) add('boris', 'kill:' + b.id, 'warn', `${tag}: сработал дневной лимит убытка`, 'не открывать новых сделок до следующего дня');
    }
    // Нод: стратегии на виртуальном счёте и разбор ошибок
    const pnl = eng.dailyPnl(), alloc = eng.st.alloc || {}, paperEq = off.equity(st.books.paper);
    if (eng.err && eng.ok) add('timur', 'engine', 'warn', `ошибка в расчёте стратегий: ${clip(eng.err, 120)}`, 'найти и устранить ошибку расчёта');
    if ((alloc.trend || 0) > 0 && (pnl.trend || 0) < -0.03 * paperEq * alloc.trend) add('timur', 'trend', 'warn', `тренд на виртуальном счёте ${fmtUSD(pnl.trend, true)} — хуже −3% выделенного капитала`, 'разобрать, почему тренд отстаёт от бэктеста');
    else add('timur', 'trend', 'ok', `тренд ${Math.round((alloc.trend || 0) * 100)}% капитала, на виртуальном ${fmtUSD(pnl.trend || 0, true)}`);
    if (aiEnabled()){
      const lo = this.reviewer.lastOk, last = this.reviewer.last;
      if (last && last.error && (!lo || last.ts > lo.ts)) add('timur', 'review', 'warn', `последний разбор ошибок не удался: ${clip(last.error, 100)}`, 'повторить разбор ошибок');
      else if (!lo || now - lo.ts > 30 * H) add('timur', 'review', 'warn', 'разбор ошибок не проводился больше суток', 'провести разбор ошибок');
      else add('timur', 'review', 'ok', `разбор ошибок ${new Date(lo.ts).toLocaleString('ru-RU', {timeZone: this.CFG.tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'})}`);
    }
    // Артур: связь со счетами, незакрытые позиции, ошибки ордеров
    for (const a of Object.values(off.accounts).filter(a => a.kind === 'exchange' && a.configured)){
      if (!a.ready) add('aliya', 'acc:' + a.id, 'bad', `«${a.label}»: нет связи — ${clip(a.error || 'причина неизвестна', 160)}`, 'восстановить связь со счётом');
      else {
        const rb = (eng.st.rebal || {})[a.id], tz = {timeZone: this.CFG.tz, hour: '2-digit', minute: '2-digit'}, next = Math.floor(now / DAY) * DAY + DAY + MIN;
        add('aliya', 'acc:' + a.id, 'ok', `«${a.label}»: подключён, позиций ${(st.books[a.id] || {positions: []}).positions.length}${rb ? `; последняя ребалансировка в ${new Date(rb.ts).toLocaleTimeString('ru-RU', tz)} (сделок ${rb.trades})` : ''}; следующая — в ${new Date(next).toLocaleTimeString('ru-RU', tz)}, на закрытии дневной свечи`);
      }
    }
    for (const b of this.books()){
      const stuck = b.book.positions.filter(p => p.closeErr > 0);
      if (stuck.length) add('aliya', 'close:' + b.id, 'bad', `${b.acc.real ? 'реальный' : 'виртуальный'} счёт: не удаётся закрыть ${stuck.map(p => p.sym).join(', ')}`, 'закрыть зависшие позиции');
    }
    const errs = (st.stats && st.stats.aliya && st.stats.aliya.errors) || 0, prev = this.j.last.aliyaErr ?? errs;
    if (errs > prev) add('aliya', 'orders', 'warn', `новых ошибок ордеров: ${errs - prev}`, 'разобрать отказы биржи');
    this.j.last.aliyaErr = errs;
    return out;
  }

  // ---------- показатели и цели ----------
  logDay(){
    const d = dayStr(Date.now()), last = this.j.days[this.j.days.length - 1], e = {};
    for (const b of this.books()) e[b.id] = r2(b.eq);
    if (last && last.d === d){ Object.assign(last.e, e); return; }
    this.j.days.push({d, e}); if (this.j.days.length > 400) this.j.days.splice(0, this.j.days.length - 400);
  }
  eqAgo(id, n){
    const lim = dayStr(Date.now() - n * DAY), rows = this.j.days.filter(x => x.e[id] != null);
    if (!rows.length) return null;
    let r = null; for (const x of rows) if (x.d <= lim) r = x;
    const x = r || rows[0], days = Math.max(0, Math.round((Date.now() - Date.parse(x.d + 'T00:00:00Z')) / DAY));
    return days >= 1 ? {eq: x.e[id], days, full: !!r} : null;
  }
  measure(){
    const now = Date.now(), R = this.engine.P.risk, out = [];
    for (const b of this.books()){
      const bk = b.book, dd = bk.peak > 0 ? Math.max(0, 1 - b.eq / bk.peak) : 0;
      const cl = bk.closed.filter(c => c.tsClose > now - 14 * DAY), fees = cl.reduce((a, c) => a + (c.fees || 0), 0), win = cl.filter(c => c.pnl > 0).reduce((a, c) => a + c.pnl, 0);
      const a7 = this.eqAgo(b.id, 7), a30 = this.eqAgo(b.id, 30);
      const r7 = a7 && a7.eq > 0 ? b.eq / a7.eq - 1 : null, r30 = a30 && a30.eq > 0 ? b.eq / a30.eq - 1 : null;
      const since = bk.startEquity > 0 ? b.eq / bk.startEquity - 1 : null;
      const targets = [
        {k: 'dd', name: 'Просадка от пика', target: `меньше ${pctA(R.ddBrake, 0)}`, fact: pctA(dd), ok: dd < R.ddBrake},
        {k: 'r30', name: a30 && !a30.full ? `Результат за ${a30.days} дн.` : 'Результат за 30 дней', target: 'выше нуля', fact: r30 == null ? '—' : pctS(r30), ok: r30 == null ? null : r30 >= 0},
        {k: 'fees', name: 'Комиссии к прибыли, 14 дней', target: 'не больше 30%', fact: win > 0 ? pctA(fees / win, 0) : fees > 0 ? `${fmtUSD(fees)} при нулевой прибыли` : '—', ok: win > 0 ? fees / win <= 0.3 : fees > 0 ? false : null},
      ];
      out.push({id: b.id, label: b.acc.label, real: !!b.acc.real, equity: r2(b.eq), start: r2(bk.startEquity), since, today: r2(b.eq - bk.dayStart), r7, d7: a7 ? a7.days : null, r30, d30: a30 ? a30.days : null, dd, maxDD: bk.maxDD, trades14: cl.length, pnl14: r2(cl.reduce((a, c) => a + c.pnl, 0)), fees14: r2(fees), wins14: cl.filter(c => c.pnl > 0).length, targets});
    }
    return out;
  }

  // ---------- проверка раз в 5 минут: замечания, поручения, повод для внеплановой планёрки ----------
  refresh(act = true){
    const now = Date.now();
    this.lastCheck = now; this.checks = this.inspect(); this.logDay(); this.kpi = this.measure();
    if (!act){ this.update(); return; }
    const bad = this.checks.filter(c => c.level !== 'ok'), live = new Set(bad.map(c => c.code));
    for (const c of bad){
      this.seen[c.code] ||= now;
      const was = this.j.open[c.code];
      if (now - this.seen[c.code] < 4 * MIN) continue;                    // короткие сбои не трогаем
      if (was && LV[was.level] >= LV[c.level]){ was.text = c.text; continue; }
      this.j.open[c.code] = {agent: c.agent, level: c.level, text: c.text, since: was ? was.since : now};
      this.remark(c);
      if (c.level === 'bad' || /^dd:/.test(c.code)) this.trigger ||= `${NAME[c.agent]}: ${clip(c.text, 90)}`;
    }
    for (const [code, o] of Object.entries(this.j.open)){
      if (live.has(code)) continue;
      delete this.j.open[code];
      const t = this.j.tasks.find(t => t.code === code && t.status === 'open');
      if (t){ t.status = 'done'; t.closed = now; t.note = 'замечание снято при проверке'; }
      this.office.post('boss', o.agent, `${NAME[o.agent]}, вижу: ${clip(o.text, 80).replace(/^./, s => s.toLowerCase())} — больше не повторяется. Принято.`, 'boss');
    }
    for (const code of Object.keys(this.seen)) if (!live.has(code)) delete this.seen[code];
    // поручения по замечаниям закрываются сами, когда проверка снова в норме
    for (const t of this.j.tasks) if (t.status === 'open' && t.code && !live.has(t.code)){ t.status = 'done'; t.closed = now; t.note = 'замечание снято при проверке'; }
    // поручения старше трёх дней без отметки — просрочены
    for (const t of this.j.tasks) if (t.status === 'open' && now - t.ts > 3 * DAY){ t.status = 'expired'; t.closed = now; }
    this.j.tasks = this.j.tasks.filter(t => t.status === 'open' || now - (t.closed || t.ts) < 14 * DAY).slice(0, 60);
    // реальный счёт за день ниже −3% — повод собрать команду
    for (const b of this.books()) if (b.acc.real && b.book.dayStart > 0 && b.eq / b.book.dayStart - 1 <= -0.03) this.trigger ||= `реальный счёт за день ${pctS(b.eq / b.book.dayStart - 1)}`;
    this.save(); this.update();
  }
  remark(c){
    const text = `${NAME[c.agent]}, ${dot(c.text)}${c.task ? ` Поручение: ${dot(c.task)}` : ''}`;
    this.office.post('boss', c.agent, text, 'boss');
    if (c.task && !this.j.tasks.some(t => t.code === c.code && t.status === 'open'))
      this.j.tasks.unshift({id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ts: Date.now(), agent: c.agent, task: c.task, check: 'замечание снимется при проверке', status: 'open', code: c.code, from: 'контроль'});
    this.emit('visit', {agent: c.agent, text: clip(`${NAME[c.agent]}, ${c.text}`, 90), reply: c.level === 'bad' ? 'Понял, занимаюсь' : 'Принял'});
  }
  // обход без замечаний: раз в час с небольшим Джама подходит к одному из агентов и смотрит работу (только в 3D, без записи в ленту)
  round(){
    const agent = TEAM[this.roundK++ % TEAM.length], mine = this.checks.filter(c => c.agent === agent);
    if (mine.some(c => c.level !== 'ok')) return;
    const c = mine[0], task = this.j.tasks.find(t => t.agent === agent && t.status === 'open');
    const text = task ? `${NAME[agent]}, как с поручением: ${clip(task.task, 50)}?` : c ? `${NAME[agent]}, ${clip(c.text, 60)} — хорошо, так держать` : `${NAME[agent]}, как дела?`;
    this.emit('visit', {agent, text, reply: task ? 'В работе' : 'Всё под контролем'});
  }

  // ---------- расписание: раз в минуту ----------
  tick(){
    const now = Date.now();
    if (now - this.started > 3 * MIN && now - this.lastCheck >= 5 * MIN) this.refresh(true);
    else if (!this.lastCheck && now - this.started > 30e3) this.refresh(false);
    if (this.running) return;
    const d = new Date(now), day = dayStr(now), h = d.getUTCHours();
    // утренняя планёрка: 10:00 по Ташкенту (05:00 UTC), после ежедневного разбора ошибок
    if (h >= 5 && h < 8 && this.j.last.dailyDay !== day && !this.reviewer.running && now - this.started > 2 * MIN){
      this.j.last.dailyDay = day; this.save(); this.meeting('утренняя планёрка').catch(() => {}); return;
    }
    if (this.trigger && now - (this.j.last.meet || 0) > 3 * H && this.autoToday() < 3){ const why = this.trigger; this.trigger = null; this.meeting('внеплановая планёрка: ' + why).catch(() => {}); return; }
    if (this.trigger && now - (this.j.last.meet || 0) <= 3 * H) this.trigger = null;   // недавно собирались — разберут на следующей
    if (now - this.lastRound > 70 * MIN){ this.lastRound = now; this.round(); }
  }
  autoToday(){ const day = dayStr(Date.now()); return this.j.meetings.filter(m => !m.manual && dayStr(m.ts) === day).length; }
  nextMeeting(){
    const now = Date.now(), d = new Date(now), at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 5, 0);
    return this.j.last.dailyDay === dayStr(now) || now > at + 3 * H ? at + DAY : Math.max(at, now);
  }

  // ---------- планёрка ----------
  async meeting(why, {manual = false} = {}){
    if (this.running) throw new Error('Планёрка уже идёт');
    this.running = true; this.emit('meetStart', why); this.update();
    const now = Date.now(), rec = {id: now, ts: now, why, manual, ai: false, tasks: [], proposals: []};
    try {
      this.refresh(false);
      const prev = this.j.tasks.filter(t => t.status === 'open');
      let d = null;
      if (aiEnabled()){
        try { d = await this.aiMeeting(why, prev); rec.ai = true; }
        catch (e) { rec.aiError = e.message; console.warn('[boss] планёрка без Claude:', e.message); }
      }
      if (!d) d = this.ruleMeeting(why, prev);
      const s = (x, n) => clip(typeof x === 'string' ? x : '', n);
      rec.lines = {open: s(d.open, 260)}; for (const k of [...TEAM, 'boss']) rec.lines[k] = s(d[k], 300);
      rec.summary = s(d.summary, 600);
      rec.decisions = (Array.isArray(d.decisions) ? d.decisions : []).slice(0, 4).map(x => s(x, 200)).filter(Boolean);
      // прошлые поручения: отметка выполнения
      for (const p of Array.isArray(d.prev_tasks) ? d.prev_tasks : []){
        const t = prev.find(t => t.id === p.id); if (!t) continue;
        const stt = ['done', 'partly', 'not'].includes(p.status) ? p.status : null; if (!stt) continue;
        t.review = {status: stt, note: s(p.note, 200), ts: now};
        if (stt === 'done'){ t.status = 'done'; t.closed = now; t.note = t.review.note; }
      }
      // новые поручения
      const seen = new Set();
      for (const t of Array.isArray(d.tasks) ? d.tasks : []){
        const agent = TEAM.includes(t.agent) ? t.agent : null, task = s(t.task, 220);
        if (!agent || !task || seen.has(agent)) continue; seen.add(agent);
        if (t.code && this.j.tasks.some(x => x.code === t.code && x.status === 'open')){ rec.tasks.push({agent, task, check: s(t.check, 200)}); continue; }
        const old = this.j.tasks.find(x => x.agent === agent && x.status === 'open' && !x.code);
        if (old){ old.status = 'replaced'; old.closed = now; }
        const nt = {id: 't' + now.toString(36) + agent, ts: now, agent, task, check: s(t.check, 200), status: 'open', from: 'планёрка', meeting: rec.id, code: t.code || undefined};
        this.j.tasks.unshift(nt); rec.tasks.push({agent, task: nt.task, check: nt.check});
      }
      this.j.focus = (Array.isArray(d.focus) ? d.focus : []).slice(0, 3).map(x => s(x, 240)).filter(Boolean);
      if (this.j.focus.length) this.j.focusTs = now;
      const props = (Array.isArray(d.proposals) ? d.proposals : []).slice(0, 2);
      this.j.meetings.unshift(rec); this.j.meetings.length = Math.min(this.j.meetings.length, 40);
      this.j.last.meet = now;
      // лента
      const off = this.office;
      if (rec.lines.open) off.post('boss', 'office', rec.lines.open, 'meet');
      for (const k of TEAM) if (rec.lines[k]) off.post(k, 'boss', rec.lines[k], 'meet');
      if (rec.lines.boss) off.post('boss', 'office', rec.lines.boss, 'meet');
      if (rec.decisions.length) off.post('boss', 'office', 'Решения: ' + rec.decisions.map((x, i) => `${i + 1}) ${x}`).join(' '), 'meet');
      for (const t of rec.tasks) off.post('boss', t.agent, `Поручение: ${dot(t.task)}${t.check ? ` Проверим: ${dot(t.check)}` : ''}`, 'meet');
      off.touch();
      this.emit('meeting', {data: {...rec.lines, summary: rec.summary, why, ai: rec.ai}});
      this.save(); this.update();
      // поправки стратегий: та же проверка на истории, что у ежедневного разбора
      for (const p of props){
        let r; try { r = await this.reviewer.consider(p); } catch (e) { r = {strategy: p.strategy, param: p.param, value: p.value, verdict: 'rejected', verdictWhy: e.message}; }
        rec.proposals.push({name: r.name || p.param, strategy: r.strategy, from: r.from, value: r.value, why: clip(p.why, 200), verdict: r.verdict, verdictWhy: r.verdictWhy});
        off.post('boss', 'timur', r.verdict === 'applied' ? `Поправку с планёрки проверили на истории и приняли: «${r.name}» ${r.from} → ${r.value}. ${r.verdictWhy}.` : `Поправку с планёрки отклонили после проверки на истории: «${r.name || p.param}» → ${r.value} — ${r.verdictWhy}.`, 'meet');
      }
      if (props.length){ this.reviewer.save(); this.office.emit('review'); }
      console.log(`[boss] планёрка (${why}): ${rec.ai ? 'Claude' : 'по правилам'}, поручений ${rec.tasks.length}, поправок ${rec.proposals.length} (принято ${rec.proposals.filter(p => p.verdict === 'applied').length})`);
      return rec;
    } catch (e) {
      console.warn('[boss] планёрка сорвалась:', e.message);
      this.emit('meeting', {error: 'Планёрка сорвалась: ' + e.message});
      throw e;
    } finally { this.running = false; this.save(); this.update(); }
  }

  pack(why, prev){
    const off = this.office, eng = this.engine, rv = this.reviewer, rp = rv.pack(), lo = rv.lastOk, pv = eng.publicView();
    const trades = Object.entries(off.state.books).flatMap(([id, b]) => (off.accounts[id] ? b.closed.slice(0, 12).map(c => ({account: off.accounts[id].real ? 'реальный' : 'виртуальный', strategy: c.strategy || 'legacy', coin: c.sym, pnl_usd: r2(c.pnl), fees_usd: c.fees != null ? r2(c.fees) : null, closed: dayStr(c.tsClose || c.ts || Date.now()), reason: c.reason})) : [])).sort((a, b) => String(b.closed).localeCompare(String(a.closed))).slice(0, 14);
    const up = Object.values(pv.trend || {}).filter(x => x.sig > 0.3).length;
    return {
      reason: why, time: new Date().toLocaleString('ru-RU', {timeZone: this.CFG.tz}),
      control: TEAM.map(a => ({agent: NAME[a], id: a, zone: ZONE[a], checks: this.checks.filter(c => c.agent === a).map(c => ({level: c.level, text: c.text}))})),
      kpi: this.kpi.map(k => ({account: k.label, real: k.real, equity: k.equity, since_start_pct: k.since == null ? null : r2(k.since * 100), today_usd: k.today, d7_pct: k.r7 == null ? null : r2(k.r7 * 100), d30_pct: k.r30 == null ? null : r2(k.r30 * 100), drawdown_pct: r2(k.dd * 100), trades_14d: k.trades14, pnl_14d: k.pnl14, fees_14d: k.fees14, targets: k.targets.map(t => ({name: t.name, target: t.target, fact: t.fact, ok: t.ok}))})),
      prev_tasks: prev.map(t => ({id: t.id, agent: NAME[t.agent], task: t.task, check: t.check, given: dayStr(t.ts)})),
      last_meeting: this.j.meetings[0] ? {when: dayStr(this.j.meetings[0].ts), summary: this.j.meetings[0].summary, decisions: this.j.meetings[0].decisions} : null,
      last_review: lo ? {when: new Date(lo.ts).toISOString().slice(0, 16), summary: lo.summary, mistakes: (lo.mistakes || []).map(m => m.title), proposals: (lo.proposals || []).map(p => ({param: p.name, from: p.from, to: p.value, verdict: p.verdict, why: p.verdictWhy})), watch: lo.watch} : null,
      strategies: {alloc: pv.alloc, status: pv.status, paper_pnl_usd: pv.paperPnl, real_account: pv.real, ml: pv.model, coins_in_uptrend: up, coins_total: Object.keys(pv.trend || {}).length},
      parameters: rp.parameters, backtest: rp.backtest, recent_changes: rp.recent_changes, recent_trades: trades,
    };
  }
  async aiMeeting(why, prev){
    const system = `Ты ведёшь планёрку торгового офиса JA Capital (криптофьючерсы Binance) от лица руководителя Джамы и пишешь реплики его команды.
Команда:
- Рустам — данные рынка, тренды и новости;
- Аки — риск: просадка, размеры позиций, нагрузка на капитал;
- Нод — стратегии и сигналы: тренд-ансамбль по дневным свечам, фандинг-арбитраж (пока виртуально), возврат к среднему;
- Артур — исполнение ордеров и связь со счетами.
Джама — руководитель: спокойный и требовательный. Его главная задача — контролировать работу агентов, обсуждать стратегии и улучшать показатели офиса.
Порядок: Джама открывает планёрку (повод и главный вопрос); каждый агент докладывает по своей зоне по данным control и kpi; Джама подводит итог, принимает решения и раздаёт поручения.
Правила:
- Только факты из JSON, с цифрами. Ничего не выдумывай, доходность не обещай.
- Оцени прошлые поручения (prev_tasks): done, partly или not — по данным; если данных нет, ставь not и объясни.
- Поручения — конкретные и проверяемые за 1–3 дня, не больше одного на агента и только тем, у кого есть реальная задача.
- Поправки параметров стратегий (proposals) — не больше двух, только из списка parameters в пределах min…max и только если в данных есть основание. Каждая будет проверена на истории с 2021 года, за год и за 90 дней и принята, только если улучшит результат; через 14 дней — перепроверка на новых данных с откатом. Лучше ничего не предлагать, чем предлагать слабое. Не повторяй отклонённое за 14 дней (recent_changes).
- focus — до трёх вопросов, которые Джама передаёт в ежедневный разбор ошибок (Claude), если нужно разобраться глубже.
- Реплики агентов — от первого лица, по-русски, до 30 слов; вступление Джамы — до 25 слов; итог Джамы — до 45 слов.
Ответь только JSON:
{"open":"…","nika":"…","boris":"…","timur":"…","aliya":"…","boss":"…","summary":"2–3 предложения для журнала","decisions":["…"],"tasks":[{"agent":"nika|boris|timur|aliya","task":"…","check":"как проверим"}],"prev_tasks":[{"id":"…","status":"done|partly|not","note":"…"}],"proposals":[{"strategy":"trend|carry|mr|risk","param":"…","value":0,"why":"…"}],"focus":["…"]}`;
    const txt = await ask({system, prompt: 'Данные офиса:\n' + JSON.stringify(this.pack(why, prev)), maxTokens: 2600, kind: 'meeting'});
    return parseJSON(txt);
  }
  ruleMeeting(why, prev){
    const by = a => this.checks.filter(c => c.agent === a), worst = a => by(a).sort((x, y) => LV[y.level] - LV[x.level])[0];
    const issues = this.checks.filter(c => c.level !== 'ok').sort((x, y) => LV[y.level] - LV[x.level]);
    const d = {open: `Собрал команду: ${why}. Каждый — коротко по своей зоне.`};
    for (const a of TEAM){ const w = by(a).filter(c => c.level !== 'ok'); d[a] = w.length ? `У меня ${w.length === 1 ? 'вопрос' : w.length === 2 ? 'два вопроса' : w.length === 3 ? 'три вопроса' : w.length + ' вопросов'}: ${w.map(c => c.text).join('; ')}.` : `По моей зоне всё в норме: ${(worst(a) || {text: 'замечаний нет'}).text}.`; }
    const k = this.kpi.find(x => x.real) || this.kpi[0];
    d.boss = issues.length ? `${nIssues(issues.length).replace(/^./, c => c.toUpperCase())}. Главное — ${clip(issues[0].text, 90)}. Поручения раздал, проверю на следующем обходе.` : `Все зоны в норме.${k ? ` ${k.real ? 'Реальный' : 'Виртуальный'} счёт: просадка ${pctA(k.dd)}${k.r30 != null ? `, за ${k.d30} дн. ${pctS(k.r30)}` : ''}.` : ''} Работаем по плану.`;
    d.summary = issues.length ? `Планёрка без Claude: ${nIssues(issues.length)}, главное — ${clip(issues[0].text, 120)}.` : 'Планёрка без Claude: замечаний нет, показатели в пределах целей.';
    d.decisions = issues.length ? ['Устранить замечания до следующей проверки'] : ['Работаем по текущим настройкам'];
    d.tasks = issues.filter((c, i, arr) => arr.findIndex(x => x.agent === c.agent) === i).map(c => ({agent: c.agent, task: c.task, check: 'замечание снимется при проверке', code: c.code}));
    const live = new Set(issues.map(c => c.code));
    d.prev_tasks = prev.map(t => ({id: t.id, status: t.code && !live.has(t.code) ? 'done' : 'not', note: t.code && !live.has(t.code) ? 'замечание снято' : 'данных о выполнении нет'}));
    return d;
  }

  // ---------- для клиентов, чата и разбора ошибок ----------
  agenda(){ return this.j.focus && this.j.focus.length && Date.now() - (this.j.focusTs || 0) < 2 * DAY ? this.j.focus : null; }
  brief(){
    return {control: this.checks.filter(c => c.level !== 'ok').map(c => `${NAME[c.agent]}: ${c.text}`), all_ok: !this.checks.some(c => c.level !== 'ok'),
      kpi: this.kpi.map(k => ({account: k.label, equity: k.equity, d30_pct: k.r30 == null ? null : r2(k.r30 * 100), drawdown_pct: r2(k.dd * 100), targets: k.targets.map(t => `${t.name}: ${t.fact} (цель ${t.target})`)})),
      open_tasks: this.j.tasks.filter(t => t.status === 'open').map(t => `${NAME[t.agent]}: ${t.task}`),
      last_meeting: this.j.meetings[0] ? {when: new Date(this.j.meetings[0].ts).toLocaleString('ru-RU', {timeZone: this.CFG.tz}), summary: this.j.meetings[0].summary, decisions: this.j.meetings[0].decisions} : null,
      next_meeting: new Date(this.nextMeeting()).toLocaleString('ru-RU', {timeZone: this.CFG.tz})};
  }
  publicView(){
    return {running: this.running, checked: this.lastCheck, ai: aiEnabled(), next: this.nextMeeting(),
      checks: this.checks.map(({agent, code, level, text}) => ({agent, code, level, text})),
      kpi: this.kpi, tasks: this.j.tasks.slice(0, 24),
      meetings: this.j.meetings.slice(0, 8).map(m => ({id: m.id, ts: m.ts, why: m.why, manual: m.manual, ai: m.ai, summary: m.summary, decisions: m.decisions, tasks: m.tasks, proposals: m.proposals, lines: m.lines})),
      focus: this.agenda()};
  }
}
