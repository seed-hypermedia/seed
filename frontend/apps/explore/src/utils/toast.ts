export function showToast(message: string, duration = 3000) {
  // Create toast element
  const toast = document.createElement("div");
  toast.className =
    "fixed px-4 py-2 text-white transition-all duration-300 transform translate-y-20 bg-gray-900 rounded-lg shadow-lg opacity-0 bottom-4 right-4";
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove("translate-y-20", "opacity-0");
  });

  setTimeout(() => {
    toast.classList.add("translate-y-20", "opacity-0");
    setTimeout(() => {
      document.body.removeChild(toast);
    }, 300);
  }, duration);
}
