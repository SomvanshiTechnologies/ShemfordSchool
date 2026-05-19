/**
 * Mobile voice note components using expo-av.
 *
 * Exports:
 *   useVoiceRecorder()     — hook: hold-to-record lifecycle
 *   VoiceNotePlayer        — playback row (play/pause + scrubber + duration)
 *   HoldToRecordButton     — animated press-and-hold mic button
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Animated, StyleSheet,
  PanResponder, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';

// ─── helpers ─────────────────────────────────────────────────────────────────

const fmtMs = (ms) => {
  if (!ms || isNaN(ms)) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

// ─── useVoiceRecorder hook ────────────────────────────────────────────────────

/**
 * Returns { recording, uri, durationMs, micError, startRecording, stopRecording, reset }
 *
 * Usage (hold-to-record):
 *   <HoldToRecordButton onStart={startRecording} onStop={stopRecording} />
 *   After stopRecording() resolves, `uri` holds the file URI.
 */
export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [uri, setUri] = useState(null);
  const [durationMs, setDurationMs] = useState(0);
  const [micError, setMicError] = useState(null);
  const recRef = useRef(null);
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);

  const startRecording = useCallback(async () => {
    setMicError(null);
    try {
      const { granted, canAskAgain, status } = await Audio.requestPermissionsAsync();
      if (!granted) {
        setMicError(
          canAskAgain
            ? 'Microphone permission denied. Tap mic again to allow.'
            : 'Microphone blocked. Enable it for this app in Settings.'
        );
        console.warn('[voice] permission not granted', { status, canAskAgain });
        return false;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      recRef.current = rec;
      startTimeRef.current = Date.now();
      setRecording(true);
      setDurationMs(0);
      timerRef.current = setInterval(() => {
        setDurationMs(Date.now() - startTimeRef.current);
      }, 250);
      return true;
    } catch (err) {
      const detail = err?.message || String(err);
      // Surface the real cause so users (and devs) can act on it.
      setMicError(`Could not start recording: ${detail}`);
      console.warn('[voice] startRecording failed', err);
      return false;
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (!recRef.current) return null;
    try {
      await recRef.current.stopAndUnloadAsync();
      const fileUri = recRef.current.getURI();
      setUri(fileUri);
      setRecording(false);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      recRef.current = null;
      return fileUri;
    } catch {
      setRecording(false);
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setUri(null);
    setDurationMs(0);
    setMicError(null);
    setRecording(false);
    recRef.current = null;
  }, []);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  return { recording, uri, durationMs, micError, startRecording, stopRecording, reset };
}

// ─── VoiceNotePlayer ──────────────────────────────────────────────────────────

/**
 * Props: { uri, mimeType? }
 * Renders a compact WhatsApp-style audio player row.
 */
export const VoiceNotePlayer = ({ uri }) => {
  const soundRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  const onStatus = useCallback((status) => {
    if (!status.isLoaded) return;
    setPositionMs(status.positionMillis || 0);
    setDurationMs(status.durationMillis || 0);
    if (status.didJustFinish) {
      setPlaying(false);
      setPositionMs(0);
    }
  }, []);

  const loadAndPlay = useCallback(async () => {
    setLoading(true);
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });
      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true },
        onStatus,
      );
      soundRef.current = sound;
      setPlaying(true);
    } catch {
      // silently fail — show error state via loading=false
    } finally {
      setLoading(false);
    }
  }, [uri, onStatus]);

  const toggle = useCallback(async () => {
    if (!soundRef.current) {
      await loadAndPlay();
      return;
    }
    const status = await soundRef.current.getStatusAsync();
    if (status.isPlaying) {
      await soundRef.current.pauseAsync();
      setPlaying(false);
    } else {
      if (status.positionMillis >= (status.durationMillis || 0) - 200) {
        await soundRef.current.setPositionAsync(0);
      }
      await soundRef.current.playAsync();
      setPlaying(true);
    }
  }, [loadAndPlay]);

  const trackWidth = useRef(0);

  const seek = useCallback(async (pct) => {
    if (soundRef.current && durationMs > 0) {
      const ms = Math.round(pct * durationMs);
      await soundRef.current.setPositionAsync(ms);
      setPositionMs(ms);
    }
  }, [durationMs]);

  useEffect(() => () => { soundRef.current?.unloadAsync(); }, []);

  const progress = durationMs > 0 ? positionMs / durationMs : 0;

  // Tap-to-seek on the progress track (no extra package needed)
  const trackPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        if (trackWidth.current > 0) {
          const pct = Math.min(1, Math.max(0, evt.nativeEvent.locationX / trackWidth.current));
          seek(pct);
        }
      },
      onPanResponderMove: (evt) => {
        if (trackWidth.current > 0) {
          const pct = Math.min(1, Math.max(0, evt.nativeEvent.locationX / trackWidth.current));
          seek(pct);
        }
      },
    })
  ).current;

  return (
    <View style={styles.playerRow}>
      <TouchableOpacity onPress={toggle} style={styles.playBtn} activeOpacity={0.7}>
        {loading
          ? <ActivityIndicator size="small" color={COLORS.primary} />
          : <Ionicons name={playing ? 'pause' : 'play'} size={20} color={COLORS.primary} />
        }
      </TouchableOpacity>

      {/* Static waveform placeholder bars */}
      <View style={styles.waveform}>
        {[3,5,7,4,6,8,5,4,6,3].map((h, i) => (
          <View
            key={i}
            style={[
              styles.waveBar,
              { height: h * 2.5, opacity: progress > i * 0.1 ? 1 : 0.35 },
            ]}
          />
        ))}
      </View>

      {/* Tap-to-seek progress track */}
      <View
        style={styles.trackOuter}
        onLayout={e => { trackWidth.current = e.nativeEvent.layout.width; }}
        {...trackPanResponder.panHandlers}
      >
        <View style={[styles.trackFill, { width: `${Math.round(progress * 100)}%` }]} />
        <View style={[styles.trackThumb, { left: `${Math.round(progress * 100)}%` }]} />
      </View>

      <Text style={styles.duration}>
        {fmtMs(positionMs)}/{fmtMs(durationMs)}
      </Text>
    </View>
  );
};

// ─── HoldToRecordButton ───────────────────────────────────────────────────────

/**
 * Press-and-hold mic button.
 * Props: { onStart, onStop, disabled }
 */
export const HoldToRecordButton = ({ onStart, onStop, disabled }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const [held, setHeld] = useState(false);

  // Refs holding the latest callbacks and state, so the PanResponder (created
  // once) never reads stale closures of onStart/onStop/held/disabled.
  const heldRef = useRef(false);
  const disabledRef = useRef(disabled);
  const onStartRef = useRef(onStart);
  const onStopRef = useRef(onStop);

  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  useEffect(() => { onStartRef.current = onStart; }, [onStart]);
  useEffect(() => { onStopRef.current = onStop; }, [onStop]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: async () => {
        if (disabledRef.current) return;
        const started = await onStartRef.current?.();
        if (started === false) return;
        heldRef.current = true;
        setHeld(true);
        Animated.spring(scale, { toValue: 1.25, useNativeDriver: true }).start();
      },
      onPanResponderRelease: async () => {
        if (!heldRef.current) return;
        heldRef.current = false;
        Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();
        setHeld(false);
        await onStopRef.current?.();
      },
      onPanResponderTerminate: async () => {
        if (!heldRef.current) return;
        heldRef.current = false;
        Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();
        setHeld(false);
        await onStopRef.current?.();
      },
    }),
  ).current;

  return (
    <View style={styles.holdWrap}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <View
          {...panResponder.panHandlers}
          style={[styles.holdBtn, held && styles.holdBtnActive, disabled && styles.holdBtnDisabled]}
        >
          <Ionicons
            name={held ? 'mic' : 'mic-outline'}
            size={22}
            color={held ? COLORS.white : COLORS.primary}
          />
        </View>
      </Animated.View>
      {held && (
        <View style={styles.recordingIndicator}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingText}>Recording…</Text>
        </View>
      )}
    </View>
  );
};

// ─── styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderRadius: RADIUS.xl,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
    maxWidth: 280,
  },
  playBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#E0E7FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  waveBar: {
    width: 2.5,
    backgroundColor: COLORS.primary,
    borderRadius: 2,
  },
  trackOuter: {
    flex: 1,
    height: 20,
    justifyContent: 'center',
    position: 'relative',
  },
  trackFill: {
    height: 3,
    backgroundColor: COLORS.primary,
    borderRadius: 2,
    position: 'absolute',
    left: 0,
    top: '50%',
    marginTop: -1.5,
  },
  trackThumb: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
    position: 'absolute',
    top: '50%',
    marginTop: -5,
    marginLeft: -5,
  },
  duration: {
    fontSize: 10,
    color: COLORS.primary,
    fontVariant: ['tabular-nums'],
    minWidth: 48,
    textAlign: 'right',
  },

  holdWrap: { alignItems: 'center', gap: 6 },
  holdBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#EEF2FF',
    borderWidth: 2,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  holdBtnActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
    ...SHADOW.md,
  },
  holdBtnDisabled: {
    borderColor: COLORS.border,
    opacity: 0.4,
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.danger,
  },
  recordingText: {
    fontSize: 12,
    color: COLORS.danger,
    fontWeight: '600',
  },
});
