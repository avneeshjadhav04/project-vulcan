import { useRef, useState, useCallback, useEffect } from 'react'

export function useVoiceInput({
  onTranscript,
  onInterim,
  onStart,
}: {
  onTranscript: (text: string) => void
  onInterim?: (text: string) => void
  onStart?: () => void
}) {
  const [isListening, setIsListening] = useState(false)
  const [voiceSupported, setVoiceSupported] = useState(false)

  const voiceRef = useRef<any>(null)
  const voiceTimerRef = useRef<any>(null)

  const onTranscriptRef = useRef(onTranscript)
  const onInterimRef = useRef(onInterim)
  const onStartRef = useRef(onStart)

  useEffect(() => {
    onTranscriptRef.current = onTranscript
    onInterimRef.current = onInterim
    onStartRef.current = onStart
  }, [onTranscript, onInterim, onStart])

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
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = navigator.language || 'en-US'

    let finalTranscript = ''
    let retryCount = 0
    let silenceTimer: any = null
    let lastCombined = ''

    const resetSilenceTimer = () => {
      if (silenceTimer) clearTimeout(silenceTimer)
      silenceTimer = setTimeout(() => {
        if (voiceRef.current) {
          try { voiceRef.current.stop() } catch {}
        }
      }, 2500) // stop after 2.5 seconds of silence
    }

    recognition.onstart = () => {
      setIsListening(true)
      resetSilenceTimer()
      if (onStartRef.current) onStartRef.current()
    }

    recognition.onend = () => {
      setIsListening(false)
      voiceRef.current = null
      if (silenceTimer) clearTimeout(silenceTimer)
      
      const finalResult = lastCombined.trim() || finalTranscript.trim()
      if (finalResult) {
        onTranscriptRef.current(finalResult)
      }
    }

    recognition.onerror = (e: any) => {
      if (e.error === 'network' && retryCount < 1) {
        retryCount++
        setTimeout(() => {
          if (!voiceRef.current) toggle()
        }, 500)
        return
      }
      setIsListening(false)
      voiceRef.current = null
      if (silenceTimer) clearTimeout(silenceTimer)
    }

    recognition.onresult = (event: any) => {
      resetSilenceTimer()
      let interim = ''
      let currentFinal = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          currentFinal += transcript
        } else {
          interim += transcript
        }
      }
      if (currentFinal) finalTranscript += currentFinal
      
      lastCombined = (finalTranscript + interim).trim()
      if (onInterimRef.current && lastCombined) {
        onInterimRef.current(lastCombined)
      }
    }

    try {
      recognition.start()
    } catch {
      setIsListening(false)
    }
  }, [isListening])

  return { isListening, voiceSupported, checkSupport, toggle }
}
