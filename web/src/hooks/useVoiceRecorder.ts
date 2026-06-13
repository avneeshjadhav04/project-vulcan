import { useState, useRef, useCallback } from 'react'
import { api } from '../lib/api'

type VoiceState = 'idle' | 'recording' | 'transcribing' | 'error'

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
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/wav' })

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

    // Send to backend
    const blob = new Blob(audioChunks.current, { type: 'audio/wav' })
    const formData = new FormData()
    formData.append('audio', blob)

    try {
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
