import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { silverPlatterWorkflow } from "./workflows/silver-platter/definition";
import "./styles.css";

// The generic wizard shell (A5) takes registered workflow definitions through
// this prop; App.tsx's own default is intentionally empty so any card-owning
// slice (here, Silver Platter, A6) can register itself without editing the
// shared shell.
const workflows = { [silverPlatterWorkflow.id]: silverPlatterWorkflow };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App workflows={workflows} />
  </StrictMode>,
);
