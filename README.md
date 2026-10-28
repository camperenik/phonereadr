# PhoneReadr

Read PDF, EPUB, DOCX, Markdown and TXT files comfortably on a phone. Instead of showing the fixed-size PDF page, PhoneReadr pulls the text out and re-lays it out to fit your screen, at a text size you choose.

- Reflowed text: paragraphs, headings and bullets rebuilt, two-column pages read in order, hyphenated words rejoined, running headers/footers and page numbers removed
- Adjustable text size, line spacing, margins, paragraph gap, font (serif / sans / rounded), theme (light / sepia / dark), alignment
- Remembers your place in each document; tap the text to hide/show the bars; contents list from headings
- **PDF** button (PDF files only) shows the original page (tables, figures, scanned pages) with pinch-zoom
- Also opens **.md** (headings, lists, quotes, tables as text, emphasis and links cleaned), **.epub** (chapters and headings), **.docx** (heading/list styles, page breaks) and **.txt** (hard-wrapped lines are joined; "Bab/Chapter" lines become headings)
- Everything stays on the phone (IndexedDB) and works offline once installed. No server, no upload.

## Run / install on iPhone

It is a static web app (no build step). Host the folder over HTTPS, for example GitHub Pages (Settings → Pages → deploy from branch, root folder), then on the iPhone:

1. Open the URL in Safari
2. Share → **Add to Home Screen**
3. Open PhoneReadr from the home screen, tap **Open a PDF**, pick a file from Files / iCloud / Downloads

Local development: `python3 -m http.server 8123` and open http://localhost:8123.

## Limits

- Old binary `.doc` files and DRM-protected epubs are not supported.
- Scanned PDFs (images of text) have no text to reflow. Use the **PDF** button, or add OCR later.
- Complex tables and figures don't reflow; use the **PDF** button for those pages.
- Math-heavy or unusual layouts may need the PDF button too.

`vendor/` contains [JSZip](https://stuk.github.io/jszip/) (MIT, for epub/docx) and the [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0) legacy build for older iOS Safari.
