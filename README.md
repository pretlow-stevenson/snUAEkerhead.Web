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

The checks exercise navigation, focus, motion controls and clipboard fallbacks. Native dialog behavior and responsive image framing also require browser checks.

When changing the script or stylesheet, update its asset version in `index.html` so cached browser assets match the current markup.

The hero photograph pans and zooms over 12 seconds, then returns over 12 seconds. Visitors can pause it. Reduced-motion preferences disable animation, and open dialogs or hidden documents suspend it.

Enquiries provide a direct email link to `enquiries@snuaekerhead.ae` and a Copy address button with a manual selection fallback. Visitors write through their email application; the site has no enquiry form or backend.

The favicon and touch icon use the existing brand emblem. The supplied photographs and brand artwork remain the sources for the delivered assets. Manrope is self-hosted with its SIL Open Font License in `fonts/`.

`CNAME` retains the custom domain `snuaekerhead.ae`.
