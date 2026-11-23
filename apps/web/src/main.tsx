import { render } from "preact";
import { App } from "./App.js";
import "./app.css";

render(<App />, document.getElementById("root")!);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  addEventListener("load", () => {
    navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" }).catch((err) => console.warn("service worker not registered", err));
  });
}
