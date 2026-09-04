import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { silverPocketWorkflow } from "./workflows/silver-pocket/definition";
import "./styles.css";

// The generic wizard shell takes registered workflow definitions through this
// prop. Silver Pocket supplies provider-neutral workflow content without
// coupling the shared shell to one model or automation framework.
const workflows = { [silverPocketWorkflow.id]: silverPocketWorkflow };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App workflows={workflows} />
  </StrictMode>,
);
