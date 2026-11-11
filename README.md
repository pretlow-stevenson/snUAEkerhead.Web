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

The checks exercise navigation, interrupted transitions, focus, automatic motion suspension and local dependencies. Native dialog behavior, transition easing and responsive image framing also require browser checks.

When changing the script or stylesheet, update its asset version in `index.html` so cached browser assets match the current markup.

The hero photograph pans and zooms over 12 seconds, then returns over 12 seconds. Reduced-motion preferences disable animation, and open dialogs or hidden documents suspend it.

The interactive landing fits the available viewport height, adapting its spacing and composition for portrait and landscape screens. Enquiries and Menu sit over the photograph’s upper-right corner on desktop and mobile, with a stationary dark gradient for contrast. There is no separate page header or footer navigation. Longer editorial content scrolls inside the menu panel. Very short windows and the no-JavaScript reading view retain normal scrolling so text and controls remain accessible.

The menu and editorial sections share a stable panel width. Opening takes 520 ms and closing takes 380 ms, with a fading backdrop; content changes fade out over 160 ms and in over 240 ms. The dialog retains its modal focus boundary and scroll lock until exit completes. Reduced motion and hidden tabs settle pending transitions immediately. Interrupted navigation uses the latest destination. Keyboard focus moved deliberately to a persistent header control remains there while the next section appears; settling an incoming transition preserves reading position.

About presents our UAE foundation, personal-style perspective and design approach as one narrative under “Presence and control.” Exploration presents cultural learning and design influences in one narrative headed “What we bring back.” The developing Travel Series remains clearly distinguished from released products. The navigation previews each destination. Editorial sections contain no duplicated hero imagery; the same content remains available without JavaScript. The hero photograph has no repeated caption strip.

Enquiries provide a direct email link to `enquiries@snuaekerhead.ae`. Visitors write through their email application; the site has no enquiry form or backend.

The favicon and touch icon use the existing brand emblem. The hero presents the single “Always Exploring” headline without an emblem. The larger serif headline scales with the viewport; its supporting sentence stays on one line on desktop and wraps naturally on mobile. The supplied photographs and brand artwork remain the sources for the delivered assets. Instrument Sans and Newsreader are self-hosted with their SIL Open Font Licenses in `fonts/`. Instrument Sans carries the identity, supporting text, navigation and reading text. Newsreader sets the hero headline and the three editorial panel titles, including their no-JavaScript equivalents. Both editorial sections use the same pullquote treatment. The shared scale uses 14px utilities, 16–17px body text and 32px menu labels and 32–34px serif panel titles; hero sizes adapt to the viewport. Short screens reclaim spacing rather than reducing body text. The former fonts remain as inactive source assets.

`CNAME` retains the custom domain `snuaekerhead.ae`.
