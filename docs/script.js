const buttons = document.querySelectorAll('[data-copy]');
const hint = document.querySelector('#copy-hint');

buttons.forEach((button) => {
  button.addEventListener('click', async () => {
    const command = button.getAttribute('data-copy');
    if (!command) return;

    try {
      await navigator.clipboard.writeText(command);
      if (hint) hint.textContent = 'Copied: ' + command;
    } catch {
      if (hint) hint.textContent = 'Copy failed. Select the command text manually.';
    }
  });
});

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
      }
    });
  },
  { threshold: 0.18 },
);

document.querySelectorAll('.slide').forEach((slide) => {
  observer.observe(slide);
});
