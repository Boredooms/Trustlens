// Demo-site inertness. Loaded as an external script (CSP: script-src 'self'; no inline handlers).
//
// Every form on these pages is a prop. Submitting is cancelled and the user is told nothing was sent.
// This script never reads an input's value, never logs, never stores and never makes a request.
// (The server's CSP `form-action 'none'` is a second, independent guarantee.)
(function () {
  "use strict";

  var MESSAGE = "Demonstration only — nothing was sent.";

  function statusFor(container) {
    var existing = container.querySelector(".demo-status");
    if (existing) return existing;
    var p = document.createElement("p");
    p.className = "demo-status";
    p.setAttribute("role", "status");
    p.setAttribute("aria-live", "polite");
    container.appendChild(p);
    return p;
  }

  function announce(container) {
    var status = statusFor(container);
    status.textContent = "";
    // Re-set on the next frame so screen readers announce repeated submits.
    window.requestAnimationFrame(function () {
      status.textContent = MESSAGE;
    });
  }

  function wireForm(form) {
    if (form.dataset.demoInert === "1") return;
    form.dataset.demoInert = "1";
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      // Clear whatever was typed without ever reading it.
      form.reset();
      announce(form);
    });
  }

  function wireAll() {
    var forms = document.querySelectorAll("form");
    for (var i = 0; i < forms.length; i++) wireForm(forms[i]);
  }

  // upi:// hand-off links would leave the browser for a payment app; keep them inert too.
  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!(target instanceof Element)) return;
    var link = target.closest('a[href^="upi:"]');
    if (!link) return;
    event.preventDefault();
    announce(link.closest("section") || link.parentElement || document.body);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireAll);
  } else {
    wireAll();
  }
})();
