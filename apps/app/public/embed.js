/**
 * Tallyvis universal website embed (Phase 14 — see
 * docs/decisions/0016-onboarding-billing-embed.md).
 *
 * Usage (the snippet the dashboard's "Website → Install Tallyvis" page
 * gives each business, with its own real embed id already filled in):
 *
 *   <div id="tallyvis-estimator"></div>
 *   <script src="https://app.tallyvis.com/embed.js" data-tallyvis-id="YOUR_EMBED_ID"></script>
 *
 * Deliberately plain, dependency-free JavaScript — this file is served
 * as-is to an arbitrary third-party website, not built/bundled, so it has
 * to run correctly with zero assumptions about that site's own tooling.
 *
 * Isolation: the estimator itself runs inside an <iframe>, which the
 * browser already isolates from the host page's CSS and JavaScript in
 * both directions — the host page's stylesheets can never leak into the
 * iframe and vice versa, and (since the iframe is same-origin only with
 * app.tallyvis.com, not the host site) host-page JavaScript cannot reach
 * into the iframe's DOM or application state, nor can the iframe reach
 * the host page's, beyond the one explicit postMessage channel below used
 * only to auto-size the iframe's height.
 */
(function () {
  "use strict";

  var currentScript = document.currentScript;
  if (!currentScript) return;

  var embedId = currentScript.getAttribute("data-tallyvis-id");
  if (!embedId) {
    console.error("[Tallyvis] embed.js is missing a data-tallyvis-id attribute.");
    return;
  }

  var targetId = currentScript.getAttribute("data-target-id") || "tallyvis-estimator";
  var origin = new URL(currentScript.src).origin;

  function mount() {
    var target = document.getElementById(targetId);
    if (!target) {
      console.error('[Tallyvis] No element with id "' + targetId + '" found to mount the estimator into.');
      return;
    }

    var iframe = document.createElement("iframe");
    iframe.src = origin + "/embed/" + encodeURIComponent(embedId);
    iframe.title = "Get an estimate";
    iframe.style.width = "100%";
    iframe.style.minHeight = "640px";
    iframe.style.border = "0";
    iframe.style.display = "block";
    // Intentionally no "allow-same-origin" together with "allow-scripts" in
    // a way that would let the iframe script itself out of its sandbox —
    // this iframe IS app.tallyvis.com, a trusted first-party origin we
    // control, so it simply runs normally rather than being sandboxed
    // against itself; the isolation this file relies on is the ordinary
    // cross-origin browser boundary between the host page and this iframe.
    iframe.setAttribute("loading", "lazy");

    target.replaceChildren(iframe);

    window.addEventListener("message", function (event) {
      if (event.origin !== origin) return;
      if (!event.data || event.data.source !== "tallyvis-embed") return;
      if (event.data.type === "resize" && typeof event.data.height === "number") {
        iframe.style.height = event.data.height + "px";
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
