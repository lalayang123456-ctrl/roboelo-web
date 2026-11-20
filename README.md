# RoboElo paper page

Open `index.html` directly in a browser. For a local HTTP preview, run the following command in this directory and open `http://127.0.0.1:8765/`.

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

The page is static. It uses plain HTML, CSS, and JavaScript, and the browser can load all assets locally.

`assets/figure-data.js` contains the Fig. 1 snapshot. `python -B scripts/export_figure.py` regenerates it using the adjacent `RoboElo` and `RoboElo_paper_figures_all` directories and the research environment's Python dependencies. The export uses the saved Fig. 1 trend and forecast metadata, policy ratings, release dates, and task difficulty distributions. Regenerate the paper's forecast metadata first when updating the underlying analysis.

`assets/roboelo-paper.pdf` and `assets/roboelo-method.png` are local copies of the supplied anonymous manuscript and its Fig. 4. The header and BibTeX use the manuscript's anonymous author designation.
