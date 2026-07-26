import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Overlay } from "./Overlay";
import "./styles.css";

const isOverlay = window.location.hash === "#/overlay";

if (isOverlay) {
  document.documentElement.classList.add("overlay-html");
  document.body.classList.add("overlay-body");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isOverlay ? <Overlay /> : <App />}</StrictMode>,
);
