// ================= LIVE: анимация прогонов конвейера, пришедших с сервера =================
function payloadName(p){ return p.k===1 ? 'сводку' : p.k===2 ? 'оценку рисков' : 'сигналы'; }
function startJob(a, job){
  a.job = job;
  if (!job || job.type !== 'run'){ a.job = null; return; }
  const st = job.run.stages[job.k]; if (!st){ a.job = null; return; }
  if (job.k === 0 && st.kind === 'news'){ emote(a, '!', 1.8); if (st.pre) say(a, st.pre, 2); }
  const DUR = {nika:1.8, boris:1.5, timur:1.1, aliya:0.9};
  const STATUS = {nika: st.kind==='news' ? 'Читает новость' : 'Сканирует рынок', boris:'Считает риски', timur:'Формирует сигналы', aliya:'Исполняет ордера'};
  act(a, {type:'work', dur: DUR[a.id] || 1.2, status: STATUS[a.id], done:()=>{
    const next = job.run.stages[job.k+1];
    if (next && AG[next.agent] && next.agent !== a.id){ handoff(a, AG[next.agent], {type:'run', run:job.run, k:job.k+1}, st.say || ''); endJob(a); }
    else { if (st.say) say(a, st.say, 2.8); if (st.react != null) react(a, {pnl: st.react}); a.job = null; }
  }});
}
function approvePending(id, ok){ wsSend({t:'approve', id, ok}); }
on('run', run=>{
  const first = run.stages && run.stages[0]; if (!first || !AG[first.agent]) return;
  const a = AG[first.agent];
  a.queue = a.queue.filter(j=>!(j.type==='run' && j.k===0));
  a.queue.push({type:'run', run, k:0});
  if (first.kind==='news') flashNews = {tone: 0.5, until: nowS()+3};
});
on('react', m=>{ const a = AG[m.agent]; if (!a) return; if (m.say) say(a, m.say, 3); react(a, {pnl: m.pnl}); });
