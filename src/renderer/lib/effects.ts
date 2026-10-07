/** Floats a "+N XP" label up from the hero. Self-removes after the animation. */
export function popXp(stageEl: HTMLElement | null, amount: number): void {
  if (!stageEl) return;
  const pop = document.createElement('div');
  pop.className = 'damage xp';
  pop.textContent = `+${amount} XP`;
  pop.style.left = '50px';
  pop.style.bottom = '58px';
  stageEl.appendChild(pop);
  setTimeout(() => pop.remove(), 900);
}
