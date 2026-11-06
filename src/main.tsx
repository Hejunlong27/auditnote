import React from "react";
import ReactDOM from "react-dom/client";
import "katex/dist/katex.min.css";
import "./styles/global.css";
import App from "./components/App";
import { PrintView } from "./views/PrintView";

const isPrintWindow =
  window.location.search.includes("print=") || Boolean(window.__MARKNOTE_PRINT_KEY__);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isPrintWindow ? <PrintView /> : <App />}</React.StrictMode>,
);
