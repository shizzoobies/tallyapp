import { useEffect, useState } from 'react'

// The beforeinstallprompt event is not in lib.dom; type the bits we use.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'tally_install_dismissed'

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}
function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIos, setShowIos] = useState(false)
  const [hidden, setHidden] = useState(
    () => localStorage.getItem(DISMISS_KEY) === '1' || isStandalone(),
  )

  useEffect(() => {
    if (hidden) return
    const onPrompt = (e: Event) => {
      e.preventDefault() // suppress the default mini-infobar so we can show our own
      setDeferred(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    // iOS Safari does not fire beforeinstallprompt, so show a manual hint there.
    if (isIos() && !isStandalone()) setShowIos(true)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [hidden])

  if (hidden || (!deferred && !showIos)) return null

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1')
    setHidden(true)
  }
  async function install() {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice.catch(() => undefined)
    setDeferred(null)
    dismiss()
  }

  return (
    <div className="install-banner">
      <span className="install-text">
        {deferred
          ? 'Install MBS Tally for one-tap access and offline open.'
          : 'Install MBS Tally: tap the Share button, then Add to Home Screen.'}
      </span>
      <span className="install-actions">
        {deferred && (
          <button className="install-btn" onClick={install}>
            Install
          </button>
        )}
        <button className="link" onClick={dismiss}>
          Dismiss
        </button>
      </span>
    </div>
  )
}
