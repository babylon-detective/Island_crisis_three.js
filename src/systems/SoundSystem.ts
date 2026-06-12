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
 *
 * Area music system:
 *   Each gameplay zone has an AreaId mapped to an MP3 file.
 *   Tone.Player loops the file; a Volume node handles fade in/out.
 *   During battle the area track is silenced (pauseAreaMusic) and restored
 *   afterwards (resumeAreaMusic) without restarting playback.
 */

// Type-only import — zero runtime cost, no AudioContext created at module load.
import type * as Tone from 'tone'

// Lazily loaded after first user gesture. Shared across all SoundSystem instances.
let _Tone: typeof import('tone') | null = null
async function loadTone(): Promise<typeof import('tone')> {
  if (!_Tone) _Tone = await import('tone')
  return _Tone
}

// ─── Area music registry ──────────────────────────────────────────────────────
// Add new zones here as the game expands.
export type AreaId = 'outdoors_beach'

const AREA_MUSIC_SRC: Record<AreaId, string> = {
  outdoors_beach: '/music/helpabeach.mp3',
}

/** Normal playback volume (dB) for area music — kept lower than SFX/battle. */
const AREA_MUSIC_DB = -14

export class SoundSystem {
  // ─── Area (zone) background music ────────────────────────────────────────
  // Signal chain:  Player (loop) → Volume → Destination
  //
  // pauseAreaMusic / resumeAreaMusic only ramp the Volume — the Player keeps
  // spinning so the loop resumes from the same position after a battle.
  //
  private areaPlayer: Tone.Player | null = null
  private areaVolume: Tone.Volume | null = null
  private currentAreaId: AreaId | null = null
  private isAreaMusicPlaying = false
  private areaStarting = false
  private areaAbort = false
  /** True while the area track is intentionally silenced for a battle. */
  private areaIsPaused = false

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
  // Public API — Area music
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Switch to the background music for the given area, or stop music when
   * called with `null`.  Safe to call while music is already playing —
   * the old track fades out before the new one starts.
   *
   * Must be invoked after (or from within) a user-gesture handler so the
   * browser allows AudioContext to resume.
   */
  async setArea(areaId: AreaId | null): Promise<void> {
    // Already on this area and playing — nothing to do.
    if (areaId === this.currentAreaId && this.isAreaMusicPlaying) return

    // Tear down any current track first (1 s cross-fade out).
    if (this.isAreaMusicPlaying) {
      this.stopAreaMusic(1)
      // Brief pause to let the fade clear before starting the new track.
      await new Promise<void>(resolve => setTimeout(resolve, 1200))
    }

    if (areaId === null) return

    this.areaStarting = true
    this.areaAbort = false
    this.currentAreaId = areaId

    try {
      const T = await loadTone()
      await T.start()
      if (this.areaAbort) return

      this.areaVolume = new T.Volume(-60).toDestination()

      this.areaPlayer = new T.Player({
        url: AREA_MUSIC_SRC[areaId],
        loop: true,
        autostart: false,
        onload: () => {
          if (this.areaAbort || !this.areaPlayer || !this.areaVolume) return
          this.areaPlayer.connect(this.areaVolume)
          this.areaPlayer.start()
          // Only fade in if we are not currently in a battle.
          if (!this.areaIsPaused) {
            this.areaVolume.volume.rampTo(AREA_MUSIC_DB, 3)
          }
          this.isAreaMusicPlaying = true
          console.log(`🎵 SoundSystem: area music started — ${areaId}`)
        },
      })
    } catch (err) {
      console.error('🎵 SoundSystem: area music failed to start', err)
      this._teardownAreaNodes()
    } finally {
      this.areaStarting = false
    }
  }

  /**
   * Silence the area music without stopping playback.
   * Call when entering a battle; the loop keeps its position.
   * @param fadeDuration seconds (default 1)
   */
  pauseAreaMusic(fadeDuration = 1): void {
    this.areaIsPaused = true
    if (!this.isAreaMusicPlaying || !this.areaVolume) return
    this.areaVolume.volume.rampTo(-60, fadeDuration)
  }

  /**
   * Restore the area music volume after a battle ends.
   * @param fadeDuration seconds (default 1.5)
   */
  resumeAreaMusic(fadeDuration = 1.5): void {
    this.areaIsPaused = false
    if (!this.isAreaMusicPlaying || !this.areaVolume) return
    this.areaVolume.volume.rampTo(AREA_MUSIC_DB, fadeDuration)
  }

  /**
   * Fully stop and dispose area music nodes.
   * @param fadeDuration seconds (default 2)
   */
  stopAreaMusic(fadeDuration = 2): void {
    this.areaAbort = true
    if (!this.isAreaMusicPlaying) return
    this.isAreaMusicPlaying = false
    this.currentAreaId = null

    const player = this.areaPlayer
    const vol    = this.areaVolume
    this.areaPlayer = null
    this.areaVolume = null

    if (fadeDuration > 0 && vol) {
      vol.volume.rampTo(-60, fadeDuration)
    }

    const delay = fadeDuration > 0 ? (fadeDuration + 0.3) * 1000 : 0
    setTimeout(() => {
      try { player?.stop(); player?.dispose() } catch { /* already disposed */ }
      try { vol?.dispose()                    } catch { /* already disposed */ }
    }, delay)
  }

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

    // Stop sequences immediately so their callbacks can no longer fire on nulled synths.
    try { bassSeq?.stop()   } catch { /* */ }
    try { leadSeq?.stop()   } catch { /* */ }
    try { kickSeq?.stop()   } catch { /* */ }
    try { snareSeq?.stop()  } catch { /* */ }
    try { hihatSeq?.stop()  } catch { /* */ }

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
      // Dispose sequences (already stopped above).
      try { bassSeq?.dispose()  } catch { /* */ }
      try { leadSeq?.dispose()  } catch { /* */ }
      try { kickSeq?.dispose()  } catch { /* */ }
      try { snareSeq?.dispose() } catch { /* */ }
      try { hihatSeq?.dispose() } catch { /* */ }

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
  // Public API — Footstep SFX
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Play a single footstep sound.  Uses the already-loaded Tone instance if
   * available; silently skips when the AudioContext has not yet been unlocked.
   * @param kind   'walk' | 'run' | 'sprint' — controls pitch/character
   */
  playFootstep(kind: 'walk' | 'run' | 'sprint' = 'walk'): void {
    const T = _Tone
    if (!T) return
    try {
      // Thud: short noise burst through a bandpass filter
      const vol = new T.Volume(-18).toDestination()
      const filt = new T.Filter({
        type: 'bandpass',
        frequency: kind === 'sprint' ? 220 : kind === 'run' ? 180 : 140,
        Q: 1.2,
      }).connect(vol)
      const synth = new T.NoiseSynth({
        noise: { type: 'pink' },
        envelope: { attack: 0.001, decay: kind === 'sprint' ? 0.055 : kind === 'run' ? 0.07 : 0.09, sustain: 0, release: 0.01 },
      }).connect(filt)
      synth.triggerAttackRelease('32n')
      // Dispose after sound completes (decay + small buffer)
      const disposeMs = (kind === 'sprint' ? 0.055 : kind === 'run' ? 0.07 : 0.09) * 1000 + 100
      setTimeout(() => {
        try { synth.dispose() } catch { /* */ }
        try { filt.dispose()  } catch { /* */ }
        try { vol.dispose()   } catch { /* */ }
      }, disposeMs)
    } catch { /* AudioContext not ready */ }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API — UI SFX
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Supported UI sound effect types:
   * - hover         : soft tick when a menu item is highlighted
   * - click         : crisp tap on button press
   * - itemHighlight : chime when an inventory item is focused
   * - menuOpen      : ascending two-note sweep when a panel opens
   * - menuClose     : descending two-note sweep when a panel closes
   * - confirm       : bright ping on successful confirm / accept
   * - cancel        : low thunk on cancel / back
   * - stat          : neutral mid ping (e.g. stat updated)
   * - dud           : short buzz for empty / disabled interaction
   */
  playUISfx(type: 'hover' | 'click' | 'itemHighlight' | 'menuOpen' | 'menuClose' | 'confirm' | 'cancel' | 'stat' | 'dud'): void {
    const T = _Tone
    if (!T) return
    try {
      this._playUISfxInternal(T, type)
    } catch { /* AudioContext not ready */ }
  }

  private _playUISfxInternal(T: typeof import('tone'), type: string): void {
    const vol = new T.Volume(-14).toDestination()
    let disposeMs = 200

    if (type === 'hover') {
      // Soft triangle tick at 900 Hz, 30 ms
      const s = new T.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.002, decay: 0.03, sustain: 0, release: 0.01 } }).connect(vol)
      s.triggerAttackRelease(900, '64n')
      disposeMs = 80
      setTimeout(() => { try { s.dispose() } catch { /* */ } }, disposeMs)

    } else if (type === 'click') {
      // Very short noise click
      const s = new T.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.012, sustain: 0, release: 0.005 } }).connect(vol)
      s.triggerAttackRelease('64n')
      disposeMs = 60
      setTimeout(() => { try { s.dispose() } catch { /* */ } }, disposeMs)

    } else if (type === 'itemHighlight') {
      // Chime: sine at 1 400 Hz, 60 ms decay
      const s = new T.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.005, decay: 0.08, sustain: 0, release: 0.02 } }).connect(vol)
      s.triggerAttackRelease(1400, '32n')
      disposeMs = 140
      setTimeout(() => { try { s.dispose() } catch { /* */ } }, disposeMs)

    } else if (type === 'menuOpen') {
      // Two-note ascending sweep: 600 → 900 Hz, staggered 60 ms
      const s1 = new T.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.005, decay: 0.07, sustain: 0, release: 0.02 } }).connect(vol)
      const s2 = new T.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.005, decay: 0.07, sustain: 0, release: 0.02 } }).connect(vol)
      s1.triggerAttackRelease(600, '32n')
      setTimeout(() => { try { s2.triggerAttackRelease(900, '32n') } catch { /* */ } }, 60)
      disposeMs = 220
      setTimeout(() => { try { s1.dispose(); s2.dispose() } catch { /* */ } }, disposeMs)

    } else if (type === 'menuClose') {
      // Two-note descending sweep: 900 → 600 Hz, staggered 60 ms
      const s1 = new T.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.005, decay: 0.07, sustain: 0, release: 0.02 } }).connect(vol)
      const s2 = new T.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.005, decay: 0.07, sustain: 0, release: 0.02 } }).connect(vol)
      s1.triggerAttackRelease(900, '32n')
      setTimeout(() => { try { s2.triggerAttackRelease(600, '32n') } catch { /* */ } }, 60)
      disposeMs = 220
      setTimeout(() => { try { s1.dispose(); s2.dispose() } catch { /* */ } }, disposeMs)

    } else if (type === 'confirm') {
      // Bright ping: sine at 1 600 Hz, short
      const s = new T.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.003, decay: 0.10, sustain: 0, release: 0.03 } }).connect(vol)
      s.triggerAttackRelease(1600, '32n')
      disposeMs = 180
      setTimeout(() => { try { s.dispose() } catch { /* */ } }, disposeMs)

    } else if (type === 'cancel') {
      // Low thunk: triangle at 350 Hz
      const s = new T.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.002, decay: 0.07, sustain: 0, release: 0.02 } }).connect(vol)
      s.triggerAttackRelease(350, '32n')
      disposeMs = 140
      setTimeout(() => { try { s.dispose() } catch { /* */ } }, disposeMs)

    } else if (type === 'stat') {
      // Neutral mid ping: sine at 1 000 Hz
      const s = new T.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.003, decay: 0.08, sustain: 0, release: 0.02 } }).connect(vol)
      s.triggerAttackRelease(1000, '32n')
      disposeMs = 150
      setTimeout(() => { try { s.dispose() } catch { /* */ } }, disposeMs)

    } else if (type === 'dud') {
      // Short low buzz: square at 180 Hz, very fast decay
      const s = new T.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.01 } }).connect(vol)
      s.triggerAttackRelease(180, '64n')
      disposeMs = 80
      setTimeout(() => { try { s.dispose() } catch { /* */ } }, disposeMs)
    }

    setTimeout(() => { try { vol.dispose() } catch { /* */ } }, disposeMs + 50)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API — lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /** Dispose all resources immediately (e.g. on page unload). */
  dispose(): void {
    this.stopAreaMusic(0)
    this.stopOceanLoop(0)
    this.stopBattleTheme_01(0)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private _teardownAreaNodes(): void {
    try { this.areaPlayer?.stop(); this.areaPlayer?.dispose() } catch { /* */ }
    try { this.areaVolume?.dispose()                          } catch { /* */ }
    this.areaPlayer = null
    this.areaVolume = null
    this.isAreaMusicPlaying = false
    this.currentAreaId = null
  }

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
