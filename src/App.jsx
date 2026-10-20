import { useCallback, useEffect, useRef, useState } from 'react';
import { centsBetween, detectPitch, median, nearestIndex } from './pitch.js';

// Afinação padrão, da 6ª (mais grave) para a 1ª corda
const STRINGS = [
  { midi: 40, letter: 'E', oct: 2, name: 'Mi', ord: '6ª' },
  { midi: 45, letter: 'A', oct: 2, name: 'Lá', ord: '5ª' },
  { midi: 50, letter: 'D', oct: 3, name: 'Ré', ord: '4ª' },
  { midi: 55, letter: 'G', oct: 3, name: 'Sol', ord: '3ª' },
  { midi: 59, letter: 'B', oct: 3, name: 'Si', ord: '2ª' },
  { midi: 64, letter: 'E', oct: 4, name: 'Mi', ord: '1ª' },
];
const A4 = 440;
const STRING_FREQS = STRINGS.map((s) => A4 * Math.pow(2, (s.midi - 69) / 12));

const TUNED_CENTS = 5; // tolerância para considerar "afinado"
const DEG_PER_CENT = 1.2; // ±50 cents = ±60° no mostrador
const TICKS = Array.from({ length: 21 }, (_, i) => i - 10); // um traço a cada 5 cents

const fmt = (n, digits) => n.toFixed(digits).replace('.', ',');

function resetDetection(d) {
  d.hist = [];
  d.lastIdx = -1;
  d.hasSignal = false;
}

/* ------------------------------------------------------------------ */
/* Áudio: microfone, detecção e nota de referência                     */
/* ------------------------------------------------------------------ */
function useTuner() {
  const [micOn, setMicOn] = useState(false);
  const [micError, setMicError] = useState('');
  const [auto, setAutoState] = useState(true);
  const [target, setTargetState] = useState(0);
  const [reading, setReading] = useState(null); // { freq, cents, idx }
  const [playing, setPlaying] = useState(-1);

  const audio = useRef({ ctx: null, stream: null, src: null, analyser: null, buf: null, raf: 0, tone: null, wakeLock: null, pending: false });
  const det = useRef({ hist: [], smooth: 0, lastIdx: -1, lastHeard: 0, frame: 0, hasSignal: false });
  const mode = useRef({ auto: true, target: 0 });
  const mounted = useRef(true);

  const getCtx = useCallback(() => {
    const a = audio.current;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!a.ctx || a.ctx.state === 'closed') a.ctx = new AC();
    if (a.ctx.state === 'suspended') a.ctx.resume().catch(() => {});
    return a.ctx;
  }, []);

  const setAuto = useCallback((value) => {
    mode.current.auto = value;
    resetDetection(det.current);
    setReading(null);
    setAutoState(value);
  }, []);

  const setTarget = useCallback((i) => {
    mode.current.target = i;
    resetDetection(det.current);
    setReading(null);
    setTargetState(i);
  }, []);

  const stopTone = useCallback(() => {
    const a = audio.current;
    const tone = a.tone;
    if (!tone || !a.ctx) return;
    a.tone = null;
    try {
      const now = a.ctx.currentTime;
      tone.gain.gain.cancelScheduledValues(now);
      tone.gain.gain.setTargetAtTime(0.0001, now, 0.02);
      tone.osc.stop(now + 0.12);
    } catch {
      /* já parado */
    }
    setPlaying(-1);
  }, []);

  // Nota de referência com timbre de corda dedilhada (harmônicos + filtro que fecha)
  const playTone = useCallback(
    (i) => {
      const ctx = getCtx();
      if (!ctx) return;
      const a = audio.current;
      stopTone();
      const f = STRING_FREQS[i];
      const t = ctx.currentTime + 0.02;

      const osc = ctx.createOscillator();
      const harmonics = new Float32Array([0, 1, 0.6, 0.35, 0.22, 0.14, 0.09, 0.05]);
      osc.setPeriodicWave(ctx.createPeriodicWave(new Float32Array(harmonics.length), harmonics));
      osc.frequency.setValueAtTime(f, t);

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(Math.min(8000, f * 12), t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(f * 2, 300), t + 2.2);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.5, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);

      osc.connect(lp).connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 2.7);

      const tone = { osc, gain };
      a.tone = tone;
      osc.onended = () => {
        if (a.tone === tone) {
          a.tone = null;
          if (mounted.current) setPlaying(-1);
        }
      };
      mode.current.target = i;
      setTargetState(i);
      setPlaying(i);
      setMicError('');
    },
    [getCtx, stopTone]
  );

  // Laço de análise: ~30 leituras por segundo
  const loop = useCallback(() => {
    const a = audio.current;
    if (!a.analyser) return;
    a.raf = requestAnimationFrame(loop);
    const d = det.current;
    d.frame += 1;
    if (d.frame % 2) return;

    a.analyser.getFloatTimeDomainData(a.buf);
    const f = detectPitch(a.buf, a.ctx.sampleRate);
    const now = performance.now();

    if (f > 0) {
      d.hist.push(f);
      if (d.hist.length > 5) d.hist.shift();
      const freq = median(d.hist); // descarta leituras isoladas erradas
      const idx = mode.current.auto ? nearestIndex(freq, STRING_FREQS) : mode.current.target;
      const raw = centsBetween(freq, STRING_FREQS[idx]);
      if (idx !== d.lastIdx) {
        d.smooth = raw;
        d.lastIdx = idx;
      } else {
        d.smooth += 0.35 * (raw - d.smooth); // suaviza o ponteiro
      }
      d.lastHeard = now;
      d.hasSignal = true;
      setReading({ freq, cents: d.smooth, idx });
    } else if (d.hasSignal && now - d.lastHeard > 1200) {
      resetDetection(d);
      setReading(null);
    }
  }, []);

  const teardownMic = useCallback(() => {
    const a = audio.current;
    cancelAnimationFrame(a.raf);
    a.raf = 0;
    if (a.stream) a.stream.getTracks().forEach((track) => track.stop());
    if (a.src) {
      try {
        a.src.disconnect();
      } catch {
        /* ok */
      }
    }
    if (a.wakeLock) a.wakeLock.release().catch(() => {});
    a.stream = null;
    a.src = null;
    a.analyser = null;
    a.wakeLock = null;
  }, []);

  const startMic = useCallback(async () => {
    const a = audio.current;
    if (a.pending || a.analyser) return;
    const ctx = getCtx();
    const md = navigator.mediaDevices;
    if (!ctx || !md || !md.getUserMedia) {
      setMicError('Este navegador não oferece acesso ao microfone. Use as notas de referência.');
      return;
    }
    stopTone();
    a.pending = true;
    try {
      const stream = await md.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (!mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      a.stream = stream;
      a.src = ctx.createMediaStreamSource(stream);
      a.analyser = ctx.createAnalyser();
      a.analyser.fftSize = 4096;
      a.src.connect(a.analyser);
      a.buf = new Float32Array(a.analyser.fftSize);
      resetDetection(det.current);
      setReading(null);
      setMicError('');
      setMicOn(true);
      // Mantém a tela acesa enquanto afina (quando o navegador permite)
      if (navigator.wakeLock) {
        navigator.wakeLock
          .request('screen')
          .then((lock) => {
            if (a.analyser) a.wakeLock = lock;
            else lock.release().catch(() => {});
          })
          .catch(() => {});
      }
      a.raf = requestAnimationFrame(loop);
    } catch (err) {
      if (!mounted.current) return;
      const blocked = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      setMicError(
        blocked
          ? 'O microfone foi bloqueado. Libere a permissão no navegador ou use as notas de referência.'
          : 'Nenhum microfone encontrado. Use as notas de referência.'
      );
      setMicOn(false);
    } finally {
      a.pending = false;
    }
  }, [getCtx, loop, stopTone]);

  const stopMic = useCallback(() => {
    teardownMic();
    resetDetection(det.current);
    setReading(null);
    setMicOn(false);
  }, [teardownMic]);

  useEffect(() => {
    mounted.current = true;
    const a = audio.current;
    return () => {
      mounted.current = false;
      teardownMic();
      if (a.tone) {
        try {
          a.tone.osc.stop();
        } catch {
          /* ok */
        }
        a.tone = null;
      }
      if (a.ctx) a.ctx.close().catch(() => {});
      a.ctx = null;
    };
  }, [teardownMic]);

  const toggleMic = useCallback(() => {
    if (audio.current.analyser) stopMic();
    else startMic();
  }, [startMic, stopMic]);

  const toggleAuto = useCallback(() => setAuto(!mode.current.auto), [setAuto]);

  // Com o microfone ligado, tocar numa corda fixa o alvo (tocar de novo volta ao automático).
  // Com o microfone desligado, toca a nota de referência.
  const pickString = useCallback(
    (i) => {
      if (audio.current.analyser) {
        if (!mode.current.auto && mode.current.target === i) {
          setAuto(true);
        } else {
          setTarget(i);
          setAuto(false);
        }
      } else {
        playTone(i);
      }
    },
    [playTone, setAuto, setTarget]
  );

  const playReference = useCallback(
    (i) => {
      if (audio.current.analyser) stopMic();
      playTone(i);
    },
    [playTone, stopMic]
  );

  return { micOn, micError, auto, target, reading, playing, toggleMic, toggleAuto, pickString, playReference };
}

/* ------------------------------------------------------------------ */
/* Interface                                                           */
/* ------------------------------------------------------------------ */
function Toggle({ label, on, onClick, ariaLabel }) {
  return (
    <button type="button" className="toggle" aria-pressed={on} aria-label={ariaLabel} onClick={onClick}>
      <span className="toggle-label">{label}</span>
      <span className="toggle-thumb">
        <span className="led bar" />
      </span>
    </button>
  );
}

function Dial({ cents, status, note, hubLit, onHub }) {
  const clamped = Math.max(-50, Math.min(50, cents));
  const activeTick = status === 'idle' ? null : Math.round(clamped / 5);
  return (
    <div className="dial" data-status={status}>
      <svg className="scale" viewBox="0 0 320 320" aria-hidden="true">
        {TICKS.map((k) => {
          const major = k % 5 === 0;
          const cls = ['tick', major && 'major', k === 0 && 'zero', k === activeTick && 'active'].filter(Boolean).join(' ');
          return <line key={k} className={cls} x1="160" y1="10" x2="160" y2={major ? 22 : 17} transform={`rotate(${k * 6} 160 160)`} />;
        })}
        <text className="scale-label" x="21" y="115">−50</text>
        <text className="scale-label" x="299" y="115">+50</text>
      </svg>
      <div className="well" aria-hidden="true" />
      <div className="knob" aria-hidden="true" />
      <div className="pointer" aria-hidden="true" style={{ transform: `rotate(${(clamped * DEG_PER_CENT).toFixed(2)}deg)` }} />
      <div className="hub-well" aria-hidden="true" />
      <button type="button" className="hub" onClick={onHub} aria-label={`Ouvir nota de referência: ${note.name} (${note.letter}${note.oct})`}>
        <span className="note">
          <span className="note-letter">{note.letter}</span>
          <span className="note-oct">{note.oct}</span>
        </span>
        <span className="note-name">{note.name}</span>
        <span className={`led bar${hubLit ? ' on' : ''}`} />
      </button>
    </div>
  );
}

export default function App() {
  const t = useTuner();
  const hasRead = t.micOn && t.reading !== null;
  const shown = hasRead ? t.reading.idx : t.playing >= 0 ? t.playing : t.target;
  const note = STRINGS[shown];
  const noteFreq = STRING_FREQS[shown];
  const cents = hasRead ? t.reading.cents : 0;
  const inTune = hasRead && Math.abs(cents) <= TUNED_CENTS;
  const flat = hasRead && cents < -TUNED_CENTS;
  const sharp = hasRead && cents > TUNED_CENTS;
  const status = inTune ? 'tuned' : hasRead ? 'reading' : 'idle';

  const rounded = Math.round(cents);
  const centsText = !hasRead || rounded === 0 ? '0' : rounded > 0 ? `+${rounded}` : `−${Math.abs(rounded)}`;

  let message;
  if (t.micError) message = t.micError;
  else if (t.playing >= 0) message = `Ouvindo ${note.name} (${note.letter}${note.oct})`;
  else if (!t.micOn) message = 'Ligue o microfone ou toque numa corda para ouvir a nota';
  else if (!hasRead) message = t.auto ? 'Toque uma corda perto do microfone' : `Toque a ${note.ord} corda (${note.name})`;
  else if (inTune) message = 'Afinado';
  else if (flat) message = 'Aperte a corda';
  else message = 'Afrouxe a corda';

  const freqText = hasRead
    ? `${fmt(t.reading.freq, 1)} Hz · alvo ${fmt(noteFreq, 1)} Hz`
    : `Alvo ${note.letter}${note.oct} · ${fmt(noteFreq, 2)} Hz`;

  return (
    <main className="app">
      <header className="top">
        <div className="brand">
          <h1>Afinador</h1>
          <p>Violão · afinação padrão</p>
        </div>
        <Toggle label="MIC" on={t.micOn} onClick={t.toggleMic} ariaLabel="Microfone" />
      </header>

      <Dial cents={cents} status={status} note={note} hubLit={inTune || t.playing >= 0} onHub={() => t.playReference(shown)} />

      <section className="readout" data-status={status} aria-label="Leitura">
        <div className="cents-row">
          <span className={`dir flat${flat ? ' lit' : ''}`}>♭ GRAVE</span>
          <span className="cents">
            {centsText}
            <small>¢</small>
          </span>
          <span className={`dir sharp${sharp ? ' lit' : ''}`}>AGUDO ♯</span>
        </div>
        <p className={`message${t.micError ? ' warn' : ''}`} aria-live="polite">
          {message}
        </p>
        <p className="freq">{freqText}</p>
      </section>

      <section className="strings" aria-labelledby="strings-title">
        <div className="strings-head">
          <h2 id="strings-title">Cordas</h2>
          <Toggle label="AUTO" on={t.auto} onClick={t.toggleAuto} ariaLabel="Detecção automática da corda" />
        </div>
        <div className="pad">
          {STRINGS.map((s, i) => {
            const active = hasRead ? i === t.reading.idx : t.playing >= 0 ? i === t.playing : (!t.micOn || !t.auto) && i === t.target;
            const pressed = t.playing === i || (t.micOn && !t.auto && t.target === i);
            return (
              <div className="socket" key={s.ord}>
                <button
                  type="button"
                  className={`str${active ? ' active' : ''}`}
                  aria-pressed={pressed}
                  aria-label={`${s.ord} corda, ${s.name} (${s.letter}${s.oct})`}
                  onClick={() => t.pickString(i)}
                >
                  <span className={`led dot${active ? ' on' : ''}`} />
                  <span className="str-letter">{s.letter}</span>
                  <span className="str-sub">
                    {s.ord} · {s.name}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
