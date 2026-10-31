import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
const c = "</script><!-- KEY 09f5c47e --><script>";
console.log(renderToString(h("body", null, h("script", { type: "text/plain" }, c), h("noscript", null, c), h("style", null, c))));
