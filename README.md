# snUAEkerhead

A static landing page for snUAEkerhead, with About, Exploration and Enquiries in an accessible dialog menu. The site uses local fonts and images; no build or runtime dependencies are required.

From this repository, preview with:

```sh
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/`. Run the regression checks with Node.js:

```sh
node --check site.js
node --test tests/site.test.cjs
```

The checks exercise navigation, interrupted transitions, focus, motion controls and clipboard fallbacks. Native dialog behavior, transition easing and responsive image framing also require browser checks.

When changing the script or stylesheet, update its asset version in `index.html` so cached browser assets match the current markup.

The hero photograph pans and zooms over 12 seconds, then returns over 12 seconds. Visitors can pause it. Reduced-motion preferences disable animation, and open dialogs or hidden documents suspend it.

The interactive landing fits the available viewport height, adapting its spacing and composition for portrait and landscape screens. Longer editorial content scrolls inside the menu panel. Very short windows and the no-JavaScript reading view retain normal scrolling so text and controls remain accessible.

The menu and editorial sections share a stable panel width. Opening takes 520 ms and closing takes 380 ms, with a fading backdrop; content changes fade out over 160 ms and in over 240 ms. The dialog retains its modal focus boundary and scroll lock until exit completes. Reduced motion and hidden tabs settle pending transitions immediately. Interrupted navigation uses the latest destination.

About explains our UAE foundation, presence and control, garment design priorities and individual expression. Exploration presents our Dubai and September 2026 Tokyo experiences in the same collective brand voice, distinguishing developing Travel Series concepts from released products. These sections contain no duplicated hero imagery, and the same content remains available without JavaScript.

Enquiries provide a direct email link to `enquiries@snuaekerhead.ae` and a Copy address button with a manual selection fallback. Visitors write through their email application; the site has no enquiry form or backend.

The favicon and touch icon use the existing brand emblem. The supplied photographs and brand artwork remain the sources for the delivered assets. Manrope is self-hosted with its SIL Open Font License in `fonts/`.

`CNAME` retains the custom domain `snuaekerhead.ae`.
