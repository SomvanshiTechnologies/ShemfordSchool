import React, { useState, useRef, useCallback } from 'react';
import { Mic, MicOff, Play, Pause, Trash2 } from 'lucide-react';
import { Button } from './ui/button';

// ─── Custom audio player ──────────────────────────────────────────────────────
export const VoiceNotePlayer = ({ url }) => {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const fmtTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); } else { a.play(); }
    setPlaying(!playing);
  };

  return (
    <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2 mt-2 max-w-xs">
      <audio
        ref={audioRef}
        src={url}
        onLoadedMetadata={e => setDuration(e.target.duration || 0)}
        onTimeUpdate={e => {
          const a = e.target;
          setCurrentTime(a.currentTime);
          setProgress(a.duration ? (a.currentTime / a.duration) * 100 : 0);
        }}
        onEnded={() => { setPlaying(false); setProgress(0); setCurrentTime(0); }}
      />
      <button onClick={toggle} className="text-indigo-600 hover:text-indigo-800 flex-shrink-0">
        {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
      </button>
      {/* Static waveform placeholder bars */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {[3,5,7,4,6,8,5,4,6,3].map((h, i) => (
          <div
            key={i}
            className="w-0.5 bg-indigo-400 rounded-full"
            style={{ height: `${h * 2}px`, opacity: progress > i * 10 ? 1 : 0.4 }}
          />
        ))}
      </div>
      <input
        type="range" min={0} max={100} value={progress}
        onChange={e => {
          const a = audioRef.current;
          if (a && a.duration) {
            a.currentTime = (e.target.value / 100) * a.duration;
            setProgress(Number(e.target.value));
          }
        }}
        className="flex-1 h-1 accent-indigo-600 cursor-pointer"
      />
      <span className="text-xs text-indigo-600 font-mono flex-shrink-0">
        {fmtTime(currentTime)}/{duration ? fmtTime(duration) : '—'}
      </span>
    </div>
  );
};

// ─── Recording hook ───────────────────────────────────────────────────────────
export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioURL, setAudioURL] = useState(null);
  const [duration, setDuration] = useState(0);
  const [micError, setMicError] = useState(null);
  const mediaRecorder = useRef(null);
  const chunks = useRef([]);
  const startTime = useRef(null);

  const start = useCallback(async () => {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorder.current = mr;
      chunks.current = [];
      startTime.current = Date.now();
      mr.ondataavailable = e => { if (e.data.size > 0) chunks.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunks.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        setAudioURL(URL.createObjectURL(blob));
        setDuration(Math.round((Date.now() - startTime.current) / 1000));
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start();
      setRecording(true);
    } catch (err) {
      setMicError(
        err.name === 'NotAllowedError'
          ? 'Please allow microphone access in your browser settings.'
          : 'Microphone not available.'
      );
    }
  }, []);

  const stop = useCallback(() => {
    if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
      mediaRecorder.current.stop();
    }
    setRecording(false);
  }, []);

  const discard = useCallback(() => {
    setAudioBlob(null);
    setAudioURL(null);
    setDuration(0);
  }, []);

  return { recording, audioBlob, audioURL, duration, micError, start, stop, discard };
}

// ─── Recorder UI widget (reusable in compose forms) ──────────────────────────
export const VoiceNoteRecorder = ({ voice }) => (
  <div className="space-y-2">
    <label className="text-sm font-medium flex items-center gap-1">
      <Mic className="h-3.5 w-3.5" /> Voice Note (optional)
    </label>
    {voice.micError && (
      <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">{voice.micError}</p>
    )}
    {!voice.audioBlob && !voice.recording && (
      <Button type="button" variant="outline" size="sm" onClick={voice.start} className="text-xs">
        <Mic className="h-3.5 w-3.5 mr-1.5 text-red-500" />
        Record voice note
      </Button>
    )}
    {voice.recording && (
      <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-sm text-red-700 font-medium">Recording…</span>
        <div className="flex gap-0.5 items-end">
          {[4,6,8,5,7,4,6,8,5,7].map((h, i) => (
            <div
              key={i}
              className="w-0.5 bg-red-400 rounded-full animate-pulse"
              style={{ height: `${h * 2}px`, animationDelay: `${i * 80}ms` }}
            />
          ))}
        </div>
        <Button type="button" size="sm" variant="destructive" className="ml-auto text-xs h-7" onClick={voice.stop}>
          <MicOff className="h-3.5 w-3.5 mr-1" /> Stop
        </Button>
      </div>
    )}
    {voice.audioBlob && !voice.recording && (
      <div className="space-y-2">
        <VoiceNotePlayer url={voice.audioURL} />
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" className="text-xs h-7"
            onClick={() => { voice.discard(); voice.start(); }}>
            <Mic className="h-3.5 w-3.5 mr-1" /> Re-record
          </Button>
          <Button type="button" size="sm" variant="ghost" className="text-xs h-7 text-red-500 hover:text-red-700"
            onClick={voice.discard}>
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Discard
          </Button>
        </div>
      </div>
    )}
  </div>
);
