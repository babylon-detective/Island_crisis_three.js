/**
 * SoundSystem — manages all game audio using Tone.js.
 *
 * Ocean wave loop (no audio files needed):
 *   Noise('pink') → Filter(lowpass) ← LFO(0.07 Hz) → Volume → Destination
 *
 * A sine LFO slowly sweeps the filter cutoff from 250 Hz → 2 500 Hz and back
 * (~14 s/cycle), mimicking the push-and-pull of ocean waves.
 * No Reverb node — avoids the async OfflineAudioContext setup that can
 * silently stall on some browsers.
 */

// Type-only import — zero runtime cost, no AudioContext created at module load.
import type * as Tone from 'tone'

// Lazily loaded after first user gesture. Shared across all SoundSystem instances.
let _Tone: typeof import('tone') | null = null
async function loadTone(): Promise<typeof import('tone')> {
  if (!_Tone) _Tone = await import('tone')
  return _Tone
}

export class SoundSystem {
  // ─── Ocean wave nodes ────────────────────────────────────────────────────
  private oceanNoise: Tone.Noise | null = null
  private oceanFilter: Tone.Filter | null = null
  private oceanLFO: Tone.LFO | null = null
  private oceanVolume: Tone.Volume | null = null

  private isOceanPlaying = false
  private oceanStarting = false
  private oceanAbort = false

  // ─── Battle theme "battle_theme_01" nodes ────────────────────────────────
  //
  // Signal graph (all signals mix into battleMasterVol → Destination):
  //
  //   Synth(sawtooth) → Filter(lowpass) → Volume → ╗
  //   Synth(square)                     → Volume → ╠─ battleMasterVol → out
  //   MembraneSynth                     → Volume → ╣
  //   NoiseSynth → Filter(highpass)     → Volume → ╣  (snare)
  //   NoiseSynth → Filter(highpass)     → Volume → ╝  (hi-hat)
  //
  // BPM 160, A-minor, 2-bar loop (32 × 16th notes).
  //
  private battleMasterVol: Tone.Volume | null = null
  // bass
  private battleBass: Tone.Synth | null = null
  private battleBassFilter: Tone.Filter | null = null
  private battleBassVol: Tone.Volume | null = null
  // lead melody
  private battleLead: Tone.Synth | null = null
  private battleLeadVol: Tone.Volume | null = null
  // kick
  private battleKick: Tone.MembraneSynth | null = null
  private battleKickVol: Tone.Volume | null = null
  // snare
  private battleSnare: Tone.NoiseSynth | null = null
  private battleSnareFilter: Tone.Filter | null = null
  private battleSnareVol: Tone.Volume | null = null
  // hi-hat
  private battleHihat: Tone.NoiseSynth | null = null
  private battleHihatFilter: Tone.Filter | null = null
  private battleHihatVol: Tone.Volume | null = null
  // sequences (typed individually to avoid `any`)
  private battleBassSeq: Tone.Sequence<string | null> | null = null
  private battleLeadSeq: Tone.Sequence<string | null> | null = null
  private battleKickSeq: Tone.Sequence<1 | null> | null = null
  private battleSnareSeq: Tone.Sequence<1 | null> | null = null
  private battleHihatSeq: Tone.Sequence<1 | null> | null = null

  private isBattlePlaying = false
  private battleStarting = false
  private battleAbort = false

  // ─────────────────────────────────────────────────────────────────────────
  // Public API — Ocean
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start the ocean ambient loop.
   * Must be called from (or after) a user-gesture handler so the browser
   * allows AudioContext to resume.
   */
  async startOceanLoop(): Promise<void> {
    if (this.isOceanPlaying || this.oceanStarting) return
    this.oceanStarting = true
    this.oceanAbort = false

    try {
      const T = await loadTone()
      console.log('🌊 SoundSystem: requesting AudioContext...')
      await T.start()
      console.log('🌊 SoundSystem: AudioContext state =', T.getContext().state)

      if (this.oceanAbort) return

      // ── Signal chain (sink → source) ─────────────────────────────────────

      // Master volume — start silent; ramp in after nodes are connected.
      this.oceanVolume = new T.Volume(-60).toDestination()

      // Lowpass filter sculpts pink noise into surf texture.
      this.oceanFilter = new T.Filter({
        type: 'lowpass',
        frequency: 800,
        rolloff: -12,
      }).connect(this.oceanVolume)

      // LFO sweeps the filter cutoff: 250 Hz ↔ 2 500 Hz at 0.07 Hz (~14 s/cycle).
      this.oceanLFO = new T.LFO({
        type: 'sine',
        frequency: 0.07,
        min: 250,
        max: 2500,
      })
      this.oceanLFO.connect(this.oceanFilter.frequency)
      this.oceanLFO.start()

      // Pink noise — spectrally similar to real ocean surf.
      this.oceanNoise = new T.Noise('pink').connect(this.oceanFilter)
      this.oceanNoise.start()

      // Fade volume in over 3 seconds.
      this.oceanVolume.volume.rampTo(-10, 3)

      this.isOceanPlaying = true
      console.log('🌊 SoundSystem: ocean loop running')
    } catch (err) {
      console.error('🌊 SoundSystem: ocean loop failed to start', err)
      this._teardownOceanNodes()
    } finally {
      this.oceanStarting = false
    }
  }

  /**
   * Stop and dispose the ocean loop.
   * @param fadeDuration Seconds to fade out before disposing nodes (default 2).
   *                     Pass 0 for immediate stop.
   */
  stopOceanLoop(fadeDuration = 2): void {
    this.oceanAbort = true

    if (!this.isOceanPlaying) return
    this.isOceanPlaying = false

    const vol    = this.oceanVolume
    const noise  = this.oceanNoise
    const filter = this.oceanFilter
    const lfo    = this.oceanLFO

    // Null out references immediately for re-entrant safety.
    this.oceanVolume = null
    this.oceanNoise  = null
    this.oceanFilter = null
    this.oceanLFO    = null

    if (fadeDuration > 0 && vol) {
      vol.volume.rampTo(-60, fadeDuration)
    }

    const delay = fadeDuration > 0 ? (fadeDuration + 0.3) * 1000 : 0

    setTimeout(() => {
      try { noise?.stop();  noise?.dispose()  } catch { /* already disposed */ }
      try { lfo?.stop();    lfo?.dispose()    } catch { /* already disposed */ }
      try { filter?.dispose()                 } catch { /* already disposed */ }
      try { vol?.dispose()                    } catch { /* already disposed */ }
    }, delay)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API — Battle theme
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start battle_theme_01 — a looping A-minor battle track (BPM 160) built
   * entirely from synthesised sources via Tone.js.
   *
   * Instruments and their roles:
   *   • Bass (sawtooth + lowpass)  — driving 2-bar riff in A minor
   *   • Lead (square wave)         — heroic 2-bar melody phrase
   *   • Kick (MembraneSynth)       — beats 1 & 3
   *   • Snare (white noise + HP)   — beats 2 & 4
   *   • Hi-hat (white noise + HP)  — steady 8th notes
   *
   * All instruments share one master Volume for unified fade in/out.
   * The global Tone.Transport is started; it is stopped in stopBattleTheme_01().
   */
  async startBattleTheme_01(): Promise<void> {
    if (this.isBattlePlaying || this.battleStarting) return
    this.battleStarting = true
    this.battleAbort = false

    try {
      const T = await loadTone()
      await T.start()
      if (this.battleAbort) return

      const transport = T.getTransport()
      transport.stop()
      transport.cancel()
      transport.bpm.value = 160
      transport.timeSignature = 4

      // ── Master volume (starts silent, fades in) ───────────────────────
      this.battleMasterVol = new T.Volume(-60).toDestination()
      const M = this.battleMasterVol

      // ── BASS — sawtooth, lowpass at 900 Hz ───────────────────────────
      //  A-minor riff: A2–E3–C3–G2–F2 over 2 bars  (16th notes, 32 steps)
      this.battleBassVol    = new T.Volume(0).connect(M)
      this.battleBassFilter = new T.Filter({ type: 'lowpass', frequency: 900, rolloff: -24 })
        .connect(this.battleBassVol)
      this.battleBass = new T.Synth({
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.005, decay: 0.12, sustain: 0.35, release: 0.25 },
      }).connect(this.battleBassFilter)

      const bassNotes: (string | null)[] = [
        'A2', null, 'A2', null, 'E3', null, 'C3', null,
        'A2', null, 'G2', null, 'F2', 'G2', null, null,
        'A2', null, 'A2', null, 'E3', null, 'C3', null,
        'D3', null, 'E3', null, 'A2', null, null, null,
      ]
      this.battleBassSeq = new T.Sequence(
        (time, note) => { if (note) this.battleBass!.triggerAttackRelease(note, '16n', time) },
        bassNotes, '16n',
      )

      // ── LEAD MELODY — square wave ──────────────────────────────────────
      //  Heroic ascending/descending A-minor phrase over 2 bars (32 steps)
      this.battleLeadVol = new T.Volume(-8).connect(M)
      this.battleLead = new T.Synth({
        oscillator: { type: 'square' },
        envelope: { attack: 0.005, decay: 0.08, sustain: 0.55, release: 0.1 },
      }).connect(this.battleLeadVol)

      const leadNotes: (string | null)[] = [
        'E5', null, null, null, 'D5', null, 'C5', null,
        'B4', null, 'C5', null, 'B4', null, 'A4', null,
        'E5', null, 'G5', null, 'A5', null, null, null,
        'G4', null, 'B4', null, 'E5', 'D5', null, null,
      ]
      this.battleLeadSeq = new T.Sequence(
        (time, note) => { if (note) this.battleLead!.triggerAttackRelease(note, '16n', time) },
        leadNotes, '16n',
      )

      // ── KICK — MembraneSynth, beats 1 & 3 ────────────────────────────
      this.battleKickVol = new T.Volume(-4).connect(M)
      this.battleKick = new T.MembraneSynth({
        pitchDecay: 0.04,
        octaves: 8,
        envelope: { attack: 0.001, decay: 0.28, sustain: 0, release: 0.08 },
      }).connect(this.battleKickVol)

      const kickSteps: (1 | null)[] = [
        1, null, null, null, null, null, null, null,
        1, null, null, null, null, null, null, null,
      ]
      this.battleKickSeq = new T.Sequence(
        (time, hit) => { if (hit) this.battleKick!.triggerAttackRelease('C1', '16n', time) },
        kickSteps, '16n',
      )

      // ── SNARE — white noise through highpass, beats 2 & 4 ────────────
      this.battleSnareVol    = new T.Volume(-10).connect(M)
      this.battleSnareFilter = new T.Filter({ type: 'highpass', frequency: 2500 })
        .connect(this.battleSnareVol)
      this.battleSnare = new T.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.04 },
      }).connect(this.battleSnareFilter)

      const snareSteps: (1 | null)[] = [
        null, null, null, null, 1, null, null, null,
        null, null, null, null, 1, null, null, null,
      ]
      this.battleSnareSeq = new T.Sequence(
        (time, hit) => { if (hit) this.battleSnare!.triggerAttackRelease('16n', time) },
        snareSteps, '16n',
      )

      // ── HI-HAT — white noise through very sharp highpass, 8th notes ──
      this.battleHihatVol    = new T.Volume(-16).connect(M)
      this.battleHihatFilter = new T.Filter({ type: 'highpass', frequency: 7000 })
        .connect(this.battleHihatVol)
      this.battleHihat = new T.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 },
      }).connect(this.battleHihatFilter)

      const hihatSteps: (1 | null)[] = [
        1, null, 1, null, 1, null, 1, null,
        1, null, 1, null, 1, null, 1, null,
      ]
      this.battleHihatSeq = new T.Sequence(
        (time, hit) => { if (hit) this.battleHihat!.triggerAttackRelease('32n', time) },
        hihatSteps, '16n',
      )

      // ── Schedule all sequences from the beginning ─────────────────────
      this.battleBassSeq.start(0)
      this.battleLeadSeq.start(0)
      this.battleKickSeq.start(0)
      this.battleSnareSeq.start(0)
      this.battleHihatSeq.start(0)

      transport.start('+0.05')

      // Crisp battle fade-in (0.8 s) — not the gentle ocean ramp
      this.battleMasterVol.volume.rampTo(-5, 0.8)

      this.isBattlePlaying = true
      console.log('⚔️ SoundSystem: battle_theme_01 playing')
    } catch (err) {
      console.error('⚔️ SoundSystem: battle_theme_01 failed to start', err)
      this._teardownBattleNodes()
    } finally {
      this.battleStarting = false
    }
  }

  /**
   * Stop battle_theme_01.
   * @param fadeDuration Seconds to fade out (default 1 s — matches the battle exit camera cut).
   *                     Pass 0 for immediate stop.
   */
  stopBattleTheme_01(fadeDuration = 1): void {
    this.battleAbort = true

    if (!this.isBattlePlaying) return
    this.isBattlePlaying = false

    // Capture and nullify all references for re-entrant safety.
    const masterVol   = this.battleMasterVol
    const bass        = this.battleBass; const bassF  = this.battleBassFilter;  const bassV  = this.battleBassVol
    const lead        = this.battleLead; const leadV  = this.battleLeadVol
    const kick        = this.battleKick; const kickV  = this.battleKickVol
    const snare       = this.battleSnare; const snareF = this.battleSnareFilter; const snareV = this.battleSnareVol
    const hihat       = this.battleHihat; const hihatF = this.battleHihatFilter; const hihatV = this.battleHihatVol
    const bassSeq     = this.battleBassSeq
    const leadSeq     = this.battleLeadSeq
    const kickSeq     = this.battleKickSeq
    const snareSeq    = this.battleSnareSeq
    const hihatSeq    = this.battleHihatSeq

    this.battleMasterVol  = null
    this.battleBass       = null; this.battleBassFilter  = null; this.battleBassVol  = null
    this.battleLead       = null; this.battleLeadVol     = null
    this.battleKick       = null; this.battleKickVol     = null
    this.battleSnare      = null; this.battleSnareFilter = null; this.battleSnareVol = null
    this.battleHihat      = null; this.battleHihatFilter = null; this.battleHihatVol = null
    this.battleBassSeq    = null; this.battleLeadSeq     = null; this.battleKickSeq  = null
    this.battleSnareSeq   = null; this.battleHihatSeq    = null

    // Start the fade.
    if (fadeDuration > 0 && masterVol) {
      masterVol.volume.rampTo(-60, fadeDuration)
    }

    const delay = fadeDuration > 0 ? (fadeDuration + 0.2) * 1000 : 0

    setTimeout(() => {
      // Stop sequences first (prevents callbacks firing after disposal).
      try { bassSeq?.stop();  bassSeq?.dispose()  } catch { /* */ }
      try { leadSeq?.stop();  leadSeq?.dispose()  } catch { /* */ }
      try { kickSeq?.stop();  kickSeq?.dispose()  } catch { /* */ }
      try { snareSeq?.stop(); snareSeq?.dispose() } catch { /* */ }
      try { hihatSeq?.stop(); hihatSeq?.dispose() } catch { /* */ }

      _Tone?.getTransport().stop()
      _Tone?.getTransport().cancel()

      // Dispose synths then their downstream nodes.
      try { bass?.dispose()  } catch { /* */ }; try { bassF?.dispose()  } catch { /* */ }; try { bassV?.dispose()  } catch { /* */ }
      try { lead?.dispose()  } catch { /* */ }; try { leadV?.dispose()  } catch { /* */ }
      try { kick?.dispose()  } catch { /* */ }; try { kickV?.dispose()  } catch { /* */ }
      try { snare?.dispose() } catch { /* */ }; try { snareF?.dispose() } catch { /* */ }; try { snareV?.dispose() } catch { /* */ }
      try { hihat?.dispose() } catch { /* */ }; try { hihatF?.dispose() } catch { /* */ }; try { hihatV?.dispose() } catch { /* */ }
      try { masterVol?.dispose() } catch { /* */ }
    }, delay)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API — lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /** Dispose all resources immediately (e.g. on page unload). */
  dispose(): void {
    this.stopOceanLoop(0)
    this.stopBattleTheme_01(0)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private _teardownOceanNodes(): void {
    try { this.oceanNoise?.stop();  this.oceanNoise?.dispose()  } catch { /* */ }
    try { this.oceanLFO?.stop();    this.oceanLFO?.dispose()    } catch { /* */ }
    try { this.oceanFilter?.dispose()                           } catch { /* */ }
    try { this.oceanVolume?.dispose()                          } catch { /* */ }
    this.oceanNoise  = null
    this.oceanLFO    = null
    this.oceanFilter = null
    this.oceanVolume = null
  }

  private _teardownBattleNodes(): void {
    [this.battleBassSeq, this.battleLeadSeq, this.battleKickSeq, this.battleSnareSeq, this.battleHihatSeq]
      .forEach(seq => { try { seq?.stop(); seq?.dispose() } catch { /* */ } })
    _Tone?.getTransport().stop()
    _Tone?.getTransport().cancel()
    try { this.battleBass?.dispose()        } catch { /* */ }
    try { this.battleBassFilter?.dispose()  } catch { /* */ }
    try { this.battleBassVol?.dispose()     } catch { /* */ }
    try { this.battleLead?.dispose()        } catch { /* */ }
    try { this.battleLeadVol?.dispose()     } catch { /* */ }
    try { this.battleKick?.dispose()        } catch { /* */ }
    try { this.battleKickVol?.dispose()     } catch { /* */ }
    try { this.battleSnare?.dispose()       } catch { /* */ }
    try { this.battleSnareFilter?.dispose() } catch { /* */ }
    try { this.battleSnareVol?.dispose()    } catch { /* */ }
    try { this.battleHihat?.dispose()       } catch { /* */ }
    try { this.battleHihatFilter?.dispose() } catch { /* */ }
    try { this.battleHihatVol?.dispose()    } catch { /* */ }
    try { this.battleMasterVol?.dispose()   } catch { /* */ }
    this.battleBassSeq = null;  this.battleLeadSeq  = null; this.battleKickSeq  = null
    this.battleSnareSeq = null; this.battleHihatSeq = null
    this.battleBass    = null;  this.battleBassFilter  = null; this.battleBassVol  = null
    this.battleLead    = null;  this.battleLeadVol     = null
    this.battleKick    = null;  this.battleKickVol     = null
    this.battleSnare   = null;  this.battleSnareFilter = null; this.battleSnareVol = null
    this.battleHihat   = null;  this.battleHihatFilter = null; this.battleHihatVol = null
    this.battleMasterVol = null
  }
}
