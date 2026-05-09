import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider } from "convex/react";
import { App } from "./App.js";
import { ConvexLiveBadge } from "./components/ConvexLiveBadge.js";
import { convexClient } from "./convex-client.js";
import "./styles.css";

const tree = (
  <>
    <App />
    <ConvexLiveBadge />
  </>
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {convexClient ? (
      <ConvexProvider client={convexClient}>{tree}</ConvexProvider>
    ) : (
      tree
    )}
  </StrictMode>,
);
