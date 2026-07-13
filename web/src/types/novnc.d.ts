declare module '@novnc/novnc' {
  export default class RFB {
    constructor(target: HTMLElement, url: string, options?: {
      shared?: boolean
      credentials?: { password: string }
      repeaterID?: string
      wsProtocols?: string[]
    })
    disconnect(): void
    sendCredentials(credentials: { password: string }): void
    sendCtrlKey(key: number): void
    sendKey(keycode: number, code: string, down?: boolean): void
    focus(): void
    blur(): void
    clipboardPasteFrom(text: string): void
    getDesktopName(): string
    supports(): Record<string, boolean>
    scaleViewport: boolean
    resizeSession: boolean
    showDotCursor: boolean
    touchButton: number
    addEventListener(type: string, listener: (e: any) => void): void
    removeEventListener(type: string, listener: (e: any) => void): void
  }
}