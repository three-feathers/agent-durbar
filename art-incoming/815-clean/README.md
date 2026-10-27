# 815: speck-cleaned copies (handoff only, not for merge)

Paco asked his agent on 2026-10-27, in the terminal: "Haz tú los cambios si son pequeños y lo puedes hacer bien" (do the small changes yourself if you can do them well).

What changed, compared with `art-incoming/815/` (and `batch5/`):

- **Specks removed.** Isolated islands of at most 40 pixels, detached from the figure in the alpha channel (8-connected), are set fully transparent. Nothing that touches the drawing is changed. The 10 files with the most removed pixels were checked visually: every removed island was in empty background.
- **Re-encoded** as WebP at quality 95 (86-92 for 7 files), to stay within the 40 KB cap. No metadata. Files with nothing to remove are byte-identical copies.
- **Not changed:** the faint semi-transparent strip, at most 3 px high, along the bottom edge of some images (for example raccoon resting and sea creature resting). At the size the office shows, it is under 1 px.

Still for Paco: sign-off on every file; the raccoon's waiting pose (mohawk or hair colour) is not consistent with its other poses; missing poses (punk cat waiting, ghost working and waiting, pirate cabin boy resting).

Scripts: `clean.py` and `comps.py`, run as `python3 clean.py <src> <out>`.
