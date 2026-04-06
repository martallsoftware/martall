import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Prevent the browser from handling dropped files (navigating to them)
// Tauri's native onDragDropEvent still fires independently
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
