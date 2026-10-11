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

The checks exercise navigation, focus, motion controls, email draft encoding and clipboard fallbacks. Native dialog behavior, email validation and responsive image framing also require browser checks.

The hero photograph pans and zooms over 12 seconds, then returns over 12 seconds. Visitors can pause it. Reduced-motion preferences disable animation, and open dialogs or hidden documents suspend it.

Enquiries prepare an email draft addressed to `enquiries@snuaekerhead.ae`. Visitors send it through their email application; the site has no enquiry backend or persistent form storage.

The favicon and touch icon use the existing brand emblem. The supplied photographs and brand artwork remain the sources for the delivered assets. Manrope is self-hosted with its SIL Open Font License in `fonts/`.

`CNAME` retains the custom domain `snuaekerhead.ae`.
