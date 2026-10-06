#!/usr/bin/env python3
"""Contrast check for the v6 tokens (floating UI + learning palette).
Run: python3 design/floating/contrast.py   (exit 1 if any pair fails)"""
import json, sys, pathlib
T = json.loads((pathlib.Path(__file__).parent.parent / "tokens.json").read_text())
def rgb(h): h = h.lstrip("#"); return [int(h[i:i+2], 16) for i in (0, 2, 4)]
def lum(c):
    f = lambda v: v/12.92 if v <= .03928 else ((v+.055)/1.055)**2.4
    r, g, b = [f(v/255) for v in c]; return .2126*r + .7152*g + .0722*b
def over(fg, bg, a): return [round(a*f + (1-a)*b) for f, b in zip(fg, bg)]
def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True); return (la+.05)/(lb+.05)
themes = {"light": T["contributedThemes"]["lienzo-papel"]["colors"], "dark": T["contributedThemes"]["lienzo-tinta"]["colors"]}
bad = 0
def check(name, fg, bg, need):
    global bad; r = ratio(fg, bg); ok = r >= need; bad += not ok
    print(f"  {'ok ' if ok else 'FAIL'} {r:5.2f} (>= {need})  {name}")
for mode, c in themes.items():
    s0, s1, s2, ink, muted = (rgb(c[k]) for k in ("background", "raised", "control", "foreground", "mutedForeground"))
    print(mode)
    for s in T["viz"]["series"]:
        col = rgb(s[mode])
        for bn, bg in (("surface1", s1), ("surface0 (stage)", s0)):
            check(f"{s['id']} text/mark on {bn}", col, bg, 4.5)
        wash = over(col, s1, T["viz"]["alpha"]["tokenWash"])
        check(f"{s['id']} ink on its token wash", ink, wash, 4.5)
        check(f"{s['id']} mark on its token wash", col, wash, 3)
    check("tooltip text (surface1 on foreground)", s1, ink, 4.5)
    check("island: muted icon on surface1", muted, s1, 4.5)
    check("island: ink on active button (accent 0.14 wash)", ink, over(rgb(c["accent"]), s1, T["island"]["button"]["activeWash"]), 4.5)
    check("island: accent icon on active wash", rgb(c["accent"]), over(rgb(c["accent"]), s1, T["island"]["button"]["activeWash"]), 3)
    lock = rgb(T["tones"]["violeta"][mode])
    check("gate: ink on violeta lock wash over stage", ink, over(lock, s0, T["alpha"]["toneWash"]), 4.5)
    check("gate: violeta icon on lock wash", lock, over(lock, s0, T["alpha"]["toneWash"]), 3)
    check("hint text (muted on surface0)", muted, s0, 4.5)
    check("hint arrow stroke (muted@0.8 on surface0)", over(muted, s0, T["hint"]["strokeAlpha"]), s0, 3)
    check("slider track (ink@0.28 on surface1)", over(ink, s1, T["learn"]["slider"]["trackAlpha"]), s1, 1.5)
    check("slider thumb ring = series colour (covered above)", rgb(T["viz"]["series"][0][mode]), s1, 3)
sys.exit(1 if bad else 0)
