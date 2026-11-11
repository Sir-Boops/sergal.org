(() => {
  const storageKey = 'swift-appearance';
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const choices = ['system', 'light', 'dark'];
  let preference = 'system';

  try {
    const saved = localStorage.getItem(storageKey);
    if (choices.includes(saved)) preference = saved;
  } catch {
    // Appearance still works for this page when storage is unavailable.
  }

  function applyAppearance() {
    const dark = preference === 'dark' || (preference === 'system' && systemTheme.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]').content = dark ? '#111815' : '#f6f8f5';
  }

  applyAppearance();
  systemTheme.addEventListener('change', applyAppearance);

  document.addEventListener('DOMContentLoaded', () => {
    const controls = document.querySelectorAll('[data-appearance]');
    function syncControls() {
      controls.forEach(control => { control.value = preference; });
    }

    syncControls();
    controls.forEach(control => control.addEventListener('change', () => {
      if (!choices.includes(control.value)) return;
      preference = control.value;
      try {
        localStorage.setItem(storageKey, preference);
      } catch {
        // Keep the selected appearance for this page.
      }
      applyAppearance();
      syncControls();
    }));
  });
})();
