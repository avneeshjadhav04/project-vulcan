import { useState, useRef, useCallback } from 'react'
import { api } from '../lib/api'

type VoiceState = 'idle' | 'recording' | 'transcribing' | 'error'

// Convert AudioBuffer to mono WAV Blob at 16kHz
async function audioBufferToWav(buffer: AudioBuffer): Promise<Blob> {
  // Resample to 16kHz mono
  const targetSampleRate = 16000
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(buffer.duration * targetSampleRate), targetSampleRate)
  const source = offlineCtx.createBufferSource()
  source.buffer = buffer
  source.connect(offlineCtx.destination)
  source.start()
  const resampled = await offlineCtx.startRendering()

  const numChannels = 1
  const numFrames = resampled.length
  const bytesPerSample = 2
  const blockAlign = numChannels * bytesPerSample
  const byteRate = targetSampleRate * blockAlign
  const dataSize = numFrames * blockAlign

  // WAV header + data
  const headerSize = 44
  const wavBuffer = new ArrayBuffer(headerSize + dataSize)
  const view = new DataView(wavBuffer)
  let offset = 0

  // RIFF chunk descriptor
  writeString(view, offset, 'RIFF')
  offset += 4
  view.setUint32(offset, 36 + dataSize, true)
  offset += 4
  writeString(view, offset, 'WAVE')
  offset += 4

  // fmt sub-chunk
  writeString(view, offset, 'fmt ')
  offset += 4
  view.setUint32(offset, 16, true)
  offset += 4
  view.setUint16(offset, 1, true)
  offset += 2
  view.setUint16(offset, numChannels, true)
  offset += 2
  view.setUint32(offset, targetSampleRate, true)
  offset += 4
  view.setUint32(offset, byteRate, true)
  offset += 4
  view.setUint16(offset, blockAlign, true)
  offset += 2
  view.setUint16(offset, 16, true)
  offset += 2

  // data sub-chunk
  writeString(view, offset, 'data')
  offset += 4
  view.setUint32(offset, dataSize, true)
  offset += 4

  // Write PCM samples
  const channelData = resampled.getChannelData(0)
  for (let i = 0; i < numFrames; i++) {
    const sample = Math.max(-1, Math.min(1, channelData[i]))
    const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF
    view.setInt16(offset, intSample, true)
    offset += 2
  }

  return new Blob([wavBuffer], { type: 'audio/wav' })
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

export function useVoiceRecorder() {
  const [state, setState] = useState<VoiceState>('idle')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [recordingTime, setRecordingTime] = useState(0)

  const mediaRecorder = useRef<MediaRecorder | null>(null)
  const audioChunks = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)

      audioChunks.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.current.push(e.data)
      }

      recorder.start()
      mediaRecorder.current = recorder
      setState('recording')
      setRecordingTime(0)
      setError(null)

      // 60-second limit
      startTimeRef.current = Date.now()

      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current
        setRecordingTime(elapsed)
        if (elapsed >= 60000) {
          stopRecording()
        }
      }, 100)
    } catch (err) {
      console.error('Mic access error:', err)
      setError('Microphone access denied. Please allow microphone access in your browser settings.')
      setState('error')
    }
  }, [])

  const stopRecording = useCallback(async () => {
    if (!mediaRecorder.current) return

    const recorder = mediaRecorder.current
    recorder.stop()
    if (timerRef.current) clearInterval(timerRef.current)

    // Wait for final data
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
    })

    // Stop all tracks to release mic
    recorder.stream.getTracks().forEach((t) => t.stop())

    setState('transcribing')

    try {
      // Decode WebM/Opus to AudioBuffer
      const webmBlob = new Blob(audioChunks.current, { type: 'audio/webm' })
      const arrayBuffer = await webmBlob.arrayBuffer()
      const audioContext = new AudioContext()
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
      audioContext.close()

      // Convert to WAV
      const wavBlob = await audioBufferToWav(audioBuffer)

      const formData = new FormData()
      formData.append('audio', wavBlob)

      const response = await api.post('/transcribe', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })

      if (response.data && response.data.text) {
        setTranscript(response.data.text)
        setState('idle')
      } else {
        throw new Error('No transcription received')
      }
    } catch (err: any) {
      console.error('Transcription error:', err)
      setError(err?.response?.data?.error || 'Transcription failed. Please try again.')
      setState('error')
    }
  }, [])

  const reset = useCallback(() => {
    setTranscript('')
    setError(null)
    setState('idle')
    setRecordingTime(0)
  }, [])

  const cancelRecording = useCallback(() => {
    if (mediaRecorder.current) {
      mediaRecorder.current.stream.getTracks().forEach((t) => t.stop())
      mediaRecorder.current = null
    }
    if (timerRef.current) clearInterval(timerRef.current)
    setState('idle')
    setRecordingTime(0)
    audioChunks.current = []
  }, [])

  return {
    state,
    transcript,
    error,
    recordingTime,
    startRecording,
    stopRecording,
    cancelRecording,
    reset,
  }
}
