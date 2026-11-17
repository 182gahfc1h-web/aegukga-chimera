/**
 * A single pre-rendered voice replayed through the application's native 2D anatomy view.
 * The WAV and .tele track share sample zero, so the 2D articulators follow the audible playhead.
 */
import { useEffect, useMemo, useState } from "react";
import { Screen } from "./Screen.tsx";
import { AnatomyView } from "./AnatomyView.tsx";
import { TeleTrack } from "../../show/tele.ts";
import { Transport } from "../../show/transport.ts";
import { getModel } from "../useModel.ts";
import { VoiceModel } from "../analysis.ts";
import { bodyLabel } from "../body.ts";
import { mouthWords } from "../mouthWords.ts";
import { V } from "../colors.ts";
import { g2p } from "../speech.ts";
import { lyricsToSyllables } from "../../wasm/engine.ts";
import { sungWords, wordAt, type Melody, type SungWords } from "../../show/words.ts";

interface ShowFile {
  title: string;
  audio: string;
  spell?: Record<string, string>;
  voices: { name: string; tele: string; melody?: string }[];
}

interface LoadedVoice {
  name: string;
  track: TeleTrack;
  words: SungWords | null;
}

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  return response;
}

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export function Show2DPage(props: { id: string }) {
  const base = `${import.meta.env.BASE_URL}shows/${props.id}/`;
  const [transport, setTransport] = useState<Transport | null>(null);
  const [voice, setVoice] = useState<LoadedVoice | null>(null);
  const [title, setTitle] = useState("Loading…");
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const instance = new Transport();
    setTransport(instance);
    return () => instance.dispose();
  }, []);

  useEffect(() => {
    if (!transport) return;
    let live = true;
    setVoice(null);
    setError(null);
    (async () => {
      const show = (await (await fetchOk(base + "show.json")).json()) as ShowFile;
      if (!show.audio || !show.voices?.length) throw new Error("show.json needs audio and at least one voice");
      if (show.voices.length !== 1) throw new Error("The 2D Play view currently expects exactly one voice in show.json");
      const definition = show.voices[0];
      const [audio, teleBytes, melody] = await Promise.all([
        fetchOk(base + show.audio).then((r) => r.arrayBuffer()),
        fetchOk(base + definition.tele).then((r) => r.arrayBuffer()),
        definition.melody ? fetchOk(base + definition.melody).then((r) => r.json() as Promise<Melody>) : Promise.resolve(null),
      ]);
      let words: SungWords | null = null;
      if (melody) {
        // Load the same language front end the 3D show uses before mapping syllables to notes.
        await g2p.load().catch(() => {});
        try {
          words = sungWords(melody, melody.syllables ?? lyricsToSyllables(melody.lyrics), show.spell);
        } catch (e) {
          console.warn("2D show: could not map lyric syllables to notes:", e);
        }
      }
      const track = new TeleTrack(teleBytes);
      await transport.load(audio);
      if (!live) return;
      setTitle(show.title || "CHIMERA 2D Play");
      setVoice({ name: definition.name || "Voice", track, words });
    })().catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [base, transport]);

  useEffect(() => {
    if (!transport) return;
    const off = transport.subscribe(() => setTick((n) => n + 1));
    const timer = window.setInterval(() => {
      if (transport.isPlaying) setTick((n) => n + 1);
    }, 100);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, [transport]);

  if (error) {
    return (
      <div className="duet">
        <header className="duet-top">
          <span className="wordmark">Chimera</span>
          <span className="duet-title">2D Play</span>
        </header>
        <p className="duet-msg error">This show could not load: {error}</p>
      </div>
    );
  }

  const state = transport?.state ?? { playing: false, time: 0, duration: 0, epoch: 0 };
  return (
    <div className="duet show2d">
      <header className="duet-top">
        <span className="wordmark">Chimera</span>
        <span className="duet-title">{title} · 2D Play</span>
      </header>
      <main className="duet-heads show2d-main" style={{ "--voices": 1 } as React.CSSProperties}>
        {voice && transport ? <RecordedVoice voice={voice} transport={transport} /> : <p className="duet-msg">Loading the voice and articulation track…</p>}
      </main>
      <footer className="duet-bar">
        <button className="primary large" disabled={!voice} onClick={() => (state.playing ? transport?.pause() : transport?.play())}>
          {state.playing ? "Pause" : state.duration > 0 && state.time >= state.duration - 0.05 ? "Again" : "Play"}
        </button>
        <span className="duet-time">{clock(state.time)} / {clock(state.duration)}</span>
        <input
          type="range"
          aria-label="Position in the song"
          min={0}
          max={state.duration || 1}
          step={0.01}
          value={state.time}
          disabled={!voice}
          onChange={(e) => transport?.seek(Number(e.target.value))}
          style={{ "--pos": `${state.duration ? (100 * state.time) / state.duration : 0}%` } as React.CSSProperties}
        />
      </footer>
    </div>
  );
}

function RecordedVoice(props: { voice: LoadedVoice; transport: Transport }) {
  const { voice, transport } = props;
  const { track } = voice;
  const model = useMemo(() => getModel(track.body, track.sampleRate), [track]);
  const getFrame = useMemo(
    () => () => {
      const time = transport.time();
      const message = track.message(track.indexAt(time));
      return {
        tele: transport.isPlaying ? message : null,
        artic: VoiceModel.articFromArray(message.t.artic),
      };
    },
    [track, transport],
  );
  const overlay = useMemo(
    () => (voice.words ? mouthWords(() => wordAt(voice.words!, transport.time()), V.green, 1) : undefined),
    [voice.words, transport],
  );

  return (
    <Screen className="duet-head show2d-face" focus title={voice.name} sub={`${bodyLabel(track.body)} · prerecorded articulation`} label={`${voice.name} voice in 2D vocal-tract view`}>
      <AnatomyView model={model} getFrame={getFrame} interactive={false} overlay={overlay} />
    </Screen>
  );
}
