// отдельный поток для тяжёлых расчётов (бэктест, проверка параметров, обучение модели), чтобы не тормозить котировки и сделки
import {parentPort, workerData} from 'node:worker_threads';
import {computeAll, validateParams, finalModel} from './backtest.js';
import * as S from './strategies.js';
try {
  const {task = 'all', data, opts} = workerData;
  let res;
  if (task === 'all') res = computeAll(data, opts);
  else if (task === 'validate') res = validateParams(data, opts);
  else if (task === 'model'){ const ser = Object.fromEntries(Object.keys(data.dd.c).filter(s => data.dd.c[s].n > 120).map(s => [s, S.trendSeries(data.dd.c[s], opts.trend)])); res = finalModel(data.dd, ser, opts.now); }
  else throw new Error('неизвестная задача ' + task);
  parentPort.postMessage({ok: true, res});
} catch (e) { parentPort.postMessage({ok: false, error: String(e && e.stack || e)}); }
