import React from "react";
import ReactDOM from "react-dom/client";
import { Island } from "./components/Island";
import "./styles/tokens.css";
import "./styles/themes.css";
import "./styles/island.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Island />
  </React.StrictMode>,
);
