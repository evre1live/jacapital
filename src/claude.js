// Обращения к Claude API (ANTHROPIC_API_KEY): разбор новостей, планёрка, разговор с агентами
import {CFG} from './config.js';

const LIMITS = {chat: 40, meeting: 8, news: 30, review: 6}; // запросов в час
const used = {chat: [], meeting: [], news: [], review: []};
export const aiEnabled = () => !!CFG.anthropicKey;

function take(kind){
  const now = Date.now(); const arr = used[kind] || (used[kind] = []);
  while (arr.length && now - arr[0] > 3.6e6) arr.shift();
  if (arr.length >= (LIMITS[kind] || 30)) { const e = new Error('Лимит обращений к Claude на этот час исчерпан'); e.code = 'rate_limited'; throw e; }
  arr.push(now);
}

export async function ask({system, messages, prompt, fast = false, model = null, maxTokens = 700, kind = 'chat'}){
  if (!aiEnabled()) { const e = new Error('Не задан ANTHROPIC_API_KEY'); e.code = 'no_key'; throw e; }
  take(kind);
  const body = {model: model || (fast ? CFG.modelFast : CFG.model), max_tokens: maxTokens, messages: messages || [{role: 'user', content: prompt}]};
  if (system) body.system = system;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {'x-api-key': CFG.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'},
    body: JSON.stringify(body), signal: AbortSignal.timeout(kind === 'review' ? 240000 : 90000),
  });
  const txt = await r.text();
  if (!r.ok){
    let msg = txt.slice(0, 300); try { msg = JSON.parse(txt).error.message || msg; } catch {}
    const e = new Error(`Claude API ${r.status}: ${msg}`); e.code = r.status === 429 ? 'rate_limited' : r.status === 401 ? 'bad_key' : 'upstream'; throw e;
  }
  const d = JSON.parse(txt);
  return (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

export function parseJSON(text){
  const t = String(text || '').trim();
  try { return JSON.parse(t); } catch {}
  const f = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) { try { return JSON.parse(f[1]); } catch {} }
  const a = Math.min(...['{', '['].map(c => { const i = t.indexOf(c); return i < 0 ? Infinity : i; }));
  const b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (isFinite(a) && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  const e = new Error('Claude ответил не в формате JSON'); e.code = 'invalid_json'; throw e;
}
export async function askJSON(opts){ return parseJSON(await ask(opts)); }
