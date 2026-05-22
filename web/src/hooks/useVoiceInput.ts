import { useRef, useState, useCallback, useEffect } from 'react'

export function useVoiceInput({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [isListening, setIsListening] = useState(false)
  const [voiceSupported, setVoiceSupported] = useState(false)

  const voiceRef = useRef<any>(null)
  const voiceTimerRef = useRef<any>(null)

  const onTranscriptRef = useRef(onTranscript)
  useEffect(() => {
    onTranscriptRef.current = onTranscript
  }, [onTranscript])

  const checkSupport = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setVoiceSupported(!!SpeechRecognition)
  }, [])

  useEffect(() => {
    checkSupport()
    return () => {
      if (voiceRef.current) {
        try { voiceRef.current.stop() } catch {}
        voiceRef.current = null
      }
      if (voiceTimerRef.current) {
        clearTimeout(voiceTimerRef.current)
        voiceTimerRef.current = null
      }
    }
  }, [checkSupport])

  const toggle = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) return

    if (isListening && voiceRef.current) {
      try { voiceRef.current.stop() } catch {}
      voiceRef.current = null
      if (voiceTimerRef.current) {
        clearTimeout(voiceTimerRef.current)
        voiceTimerRef.current = null
      }
      setIsListening(false)
      return
    }

    const recognition = new SpeechRecognition()
    voiceRef.current = recognition
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = navigator.language || 'en-US'

    let finalTranscript = ''
    let retryCount = 0

    recognition.onstart = () => {
      setIsListening(true)
    }

    recognition.onend = () => {
      setIsListening(false)
      voiceRef.current = null
      if (finalTranscript.trim()) {
        voiceTimerRef.current = setTimeout(() => {
          onTranscriptRef.current(finalTranscript.trim())
        }, 600)
      }
    }

    recognition.onerror = (e: any) => {
      const errorMessages: Record<string, string> = {
        network: 'Speech recognition network error. Please check your internet connection and try again.',
        'not-allowed': 'Microphone access denied. Please allow microphone permissions in your browser.',
        'audio-capture': 'No microphone found. Please connect a microphone and try again.',
        'service-not-allowed': 'Speech recognition service is not allowed.',
      }

      if (e.error === 'network' && retryCount < 1) {
        retryCount++
        setTimeout(() => {
          if (!voiceRef.current) {
            toggle()
          }
        }, 500)
        return
      }

      if (e.error !== 'aborted' && e.error !== 'no-speech') {
        console.error(errorMessages[e.error] || `Voice error: ${e.error}`)
      }
      setIsListening(false)
      voiceRef.current = null
    }

    recognition.onresult = (event: any) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalTranscript += transcript
        } else {
          interim += transcript
        }
      }
      // We don't set input here; caller should handle via onTranscript
    }

    try {
      recognition.start()
    } catch {
      setIsListening(false)
    }
  }, [isListening])

  return { isListening, voiceSupported, checkSupport, toggle }
}
