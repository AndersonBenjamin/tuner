// Detecção de frequência fundamental pelo algoritmo YIN
// (de Cheveigné & Kawahara, 2002), ajustado para a faixa do violão.

/**
 * Retorna a frequência fundamental (Hz) do trecho de áudio, ou -1 se não
 * houver uma nota clara (silêncio, ruído ou acorde).
 * @param {Float32Array} buf amostras no domínio do tempo (-1..1)
 * @param {number} sampleRate taxa de amostragem do AudioContext
 */
export function detectPitch(buf, sampleRate, opts = {}) {
  const minFreq = opts.minFreq ?? 60;
  const maxFreq = opts.maxFreq ?? 1000;
  const threshold = opts.threshold ?? 0.15;
  const minRms = opts.minRms ?? 0.008;

  const n = buf.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  if (Math.sqrt(rms / n) < minRms) return -1;

  const maxTau = Math.min(Math.floor(n / 2) - 1, Math.floor(sampleRate / minFreq));
  const minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
  const windowSize = Math.min(n - maxTau - 1, 1536);

  // Função diferença normalizada pela média acumulada (passos 2 e 3 do YIN)
  const d = new Float32Array(maxTau + 2);
  d[0] = 1;
  let sum = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    let s = 0;
    for (let i = 0; i < windowSize; i++) {
      const x = buf[i] - buf[i + tau];
      s += x * x;
    }
    sum += s;
    d[tau] = sum > 0 ? (s * tau) / sum : 1;
  }

  // Primeiro vale abaixo do limiar (passo 4)
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (d[t] < threshold) {
      while (t + 1 <= maxTau && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return -1;

  // Interpolação parabólica para precisão abaixo de uma amostra (passo 5)
  const a = d[tau - 1];
  const b = d[tau];
  const c = tau + 1 <= maxTau ? d[tau + 1] : b;
  const den = a + c - 2 * b;
  const exactTau = den !== 0 ? tau + (a - c) / (2 * den) : tau;
  return sampleRate / exactTau;
}

export function median(values) {
  const sorted = values.slice().sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Índice da frequência de referência mais próxima (em escala logarítmica). */
export function nearestIndex(freq, refs) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < refs.length; i++) {
    const dist = Math.abs(Math.log2(freq / refs[i]));
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

export function centsBetween(freq, ref) {
  return 1200 * Math.log2(freq / ref);
}
