// отдельный поток для расчёта бэктеста, чтобы не тормозить котировки и сделки
import {parentPort, workerData} from 'node:worker_threads';
import {computeAll} from './backtest.js';
try { parentPort.postMessage({ok: true, res: computeAll(workerData.data, workerData.opts)}); }
catch (e) { parentPort.postMessage({ok: false, error: String(e && e.stack || e)}); }
