export function showToast(message: string, duration = 3000) {
  // Create toast element
  const toast = document.createElement('div')
  toast.className =
    'fixed px-4 py-3 text-white transition-all duration-500 ease-out transform translate-y-full scale-95 bg-gray-900/90 backdrop-blur-sm rounded-xl shadow-2xl opacity-0 bottom-4 right-4 z-50 max-w-xs sm:max-w-sm cursor-pointer hover:scale-105 hover:bg-gray-800/90'
  toast.textContent = message

  // Add subtle border and better typography with text wrapping
  toast.style.border = '1px solid rgba(255, 255, 255, 0.1)'
  toast.style.fontSize = '14px'
  toast.style.fontWeight = '500'
  toast.style.wordWrap = 'break-word'
  toast.style.overflowWrap = 'break-word'
  toast.style.whiteSpace = 'pre-wrap'
  toast.style.lineHeight = '1.4'

  document.body.appendChild(toast)

  let timeoutId: NodeJS.Timeout
  let isHovered = false

  // Hover pause functionality
  toast.addEventListener('mouseenter', () => {
    isHovered = true
    clearTimeout(timeoutId)
    toast.style.animationPlayState = 'paused'
  })

  toast.addEventListener('mouseleave', () => {
    isHovered = false
    startDismissTimer()
  })

  // Click to dismiss
  toast.addEventListener('click', () => {
    dismissToast()
  })

  function startDismissTimer() {
    timeoutId = setTimeout(() => {
      if (!isHovered) {
        dismissToast()
      }
    }, duration)
  }

  function dismissToast() {
    toast.classList.add('translate-y-full', 'scale-95', 'opacity-0')
    setTimeout(() => {
      if (document.body.contains(toast)) {
        document.body.removeChild(toast)
      }
    }, 500)
  }

  // Entrance animation with slight delay for better effect
  requestAnimationFrame(() => {
    setTimeout(() => {
      toast.classList.remove('translate-y-full', 'scale-95', 'opacity-0')
      toast.classList.add('translate-y-0', 'scale-100', 'opacity-100')

      // Add a subtle bounce effect
      setTimeout(() => {
        toast.style.transform = 'translateY(0) scale(1.02)'
        setTimeout(() => {
          toast.style.transform = 'translateY(0) scale(1)'
        }, 150)
      }, 200)
    }, 50)
  })

  // Start dismiss timer
  startDismissTimer()
}
