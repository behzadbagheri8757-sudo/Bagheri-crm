# BAGHERI v71 — Dark Mode Motion Audit Patch

Patched only findings re-verified in the supplied v71 ZIP and judged low-risk.

Applied:
1. Invoice payment panel dark surface/border/shadow.
2. Theme change transient visual transition class (background/color/border/shadow only).
3. Pull-to-refresh dark material + release transition without changing drag geometry.
4. More sheet hide timer 200ms -> 280ms to match its 270ms sheet transition.
5. Generic overlay fade 220ms -> 270ms to match sheet transition.
6. closeModal DOM cleanup 240ms -> 300ms to avoid cutting the 270ms sheet animation.
7. Customer behavior chevron transition.
8. Dark form focus ring.
9. Generic sheet handle dark override.
10. Remaining confirmed dark contrast overrides: watch high severity, watch detail warning value, dashboard action toggle.
11. Route ghost background + canvas-white background rules.

Intentionally NOT patched because the supplied evidence did not make them sufficiently low-risk/confirmed:
- New-invoice post-save openSheet/closeModal sequencing (requires delaying the next sheet and changes interaction timing).
- Reports accordion grid animation.
- Invoice market details height animation.
- Confirm overlay fade/JS sequencing.
- PIN overlay fade.
- Toast content crossfade.
- Game Center crossfade.
- Reports body fade.
- Evaluation auto-advance.
- Invoice active-row height animation.
- Invoice scroll restoration.
- Shamsi picker replacement animation.
- DMT bar width transition.
- Minor input-clear/initial-canvas flashes.

Bottom navigation and active indicator were not modified.
