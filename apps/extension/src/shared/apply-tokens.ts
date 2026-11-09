// Loaded synchronously in <head> of extension pages (popup, options) so the very first frame is
// already themed: no unstyled flash while the page script loads. Tokens come from shared/tokens.ts.
import { tokensCss } from "./tokens";

const style = document.createElement("style");
style.textContent = tokensCss(":root");
document.head.appendChild(style);
