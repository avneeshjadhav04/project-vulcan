import { useState, useRef, useCallback } from 'react'

type VoiceState = 'idle' | 'connecting' | 'recording' | 'error'

interface StreamMessage {
  type: 'partial' | 'final' | 'error'
  text?: string
  error?: string
  confidence?: number
}

export function useVoiceStreaming() {
  const [state, setState] = useState<VoiceState>('idle')
  const [transcript, setTranscript] = useState('')
  const [partialText, setPartialText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [recordingTime, setRecordingTime] = useState(0)

  const wsRef = useRef<WebSocket | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)
  const partialTextRef = useRef<string>('')

  const startRecording = useCallback(async () => {
    try {
      setState('connecting')
      setError(null)
      setTranscript('')
      setPartialText('')
      partialTextRef.current = ''
      setRecordingTime(0)

      // Build WebSocket URL
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/api/transcribe/stream`

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = async () => {
        try {
          // Get microphone
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              channelCount: 1,
              sampleRate: 16000,
              echoCancellation: true,
              noiseSuppression: true,
            },
          })
          streamRef.current = stream

          // Create audio context at 16kHz
          const audioContext = new AudioContext({ sampleRate: 16000 })
          audioContextRef.current = audioContext

          const source = audioContext.createMediaStreamSource(stream)
          sourceRef.current = source

          // Buffer size: 4096 samples = ~256ms at 16kHz
          const processor = audioContext.createScriptProcessor(4096, 1, 1)
          processorRef.current = processor

          processor.onaudioprocess = (e) => {
            if (ws.readyState !== WebSocket.OPEN) return

            const inputData = e.inputBuffer.getChannelData(0)
            // Convert f32 [-1, 1] to i16 little-endian bytes
            const buffer = new ArrayBuffer(inputData.length * 2)
            const view = new DataView(buffer)
            for (let i = 0; i < inputData.length; i++) {
              const s = Math.max(-1, Math.min(1, inputData[i]))
              const intSample = s < 0 ? s * 0x8000 : s * 0x7FFF
              view.setInt16(i * 2, intSample, true)
            }
            ws.send(buffer)
          }

          source.connect(processor)
          processor.connect(audioContext.destination)

          setState('recording')
          startTimeRef.current = Date.now()

          timerRef.current = setInterval(() => {
            const elapsed = Date.now() - startTimeRef.current
            setRecordingTime(elapsed)
            if (elapsed >= 60000) {
              stopRecording()
            }
          }, 100)
        } catch (err) {
          console.error('Audio setup error:', err)
          ws.close()
          setError('Microphone setup failed. Please check permissions.')
          setState('error')
        }
      }

      ws.onmessage = (event) => {
        try {
          const data: StreamMessage = JSON.parse(event.data)
          if (data.type === 'partial' && data.text) {
            partialTextRef.current = data.text
            setPartialText(data.text)
          } else if (data.type === 'final' && data.text !== undefined) {
            setTranscript(data.text)
            setPartialText('')
            partialTextRef.current = ''
            setState('idle')
            cleanup()
          } else if (data.type === 'error') {
            setError(data.error || 'Transcription error')
            setState('error')
            cleanup()
          }
        } catch (e) {
          console.error('Failed to parse WS message:', e)
        }
      }

      ws.onerror = () => {
        setError('WebSocket connection failed')
        setState('error')
        cleanup()
      }

      ws.onclose = () => {
        if (state === 'recording' || state === 'connecting') {
          setState('idle')
          cleanup()
        }
      }
    } catch (err) {
      console.error('Mic access error:', err)
      setError('Microphone access denied. Please allow microphone access in your browser settings.')
      setState('error')
    }
  }, [])

  const stopRecording = useCallback(async () => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send('stop')
    }
    // Wait a moment for final result, then clean up audio
    setTimeout(() => {
      cleanupAudio()
    }, 500)
  }, [])

  const cancelRecording = useCallback(() => {
    cleanup()
    setState('idle')
    setRecordingTime(0)
    setPartialText('')
    setTranscript('')
  }, [])

  const reset = useCallback(() => {
    setTranscript('')
    setPartialText('')
    setError(null)
    setState('idle')
    setRecordingTime(0)
  }, [])

  function cleanupAudio() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    if (processorRef.current) {
      processorRef.current.onaudioprocess = null
      processorRef.current.disconnect()
      processorRef.current = null
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect()
      sourceRef.current = null
    }

    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }

  function cleanup() {
    cleanupAudio()

    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
  }

  return {
    state,
    transcript,
    partialText,
    error,
    recordingTime,
    startRecording,
    stopRecording,
    cancelRecording,
    reset,
  }
}
