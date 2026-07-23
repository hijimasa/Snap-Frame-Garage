import { createRoot } from "react-dom/client";
import App from "./App";
import { useStore } from "./state/store";
import "./styles.css";

// E2Eテスト・デバッグ用(コンソールから状態を触れるように)
(window as unknown as Record<string, unknown>).__sfgStore = useStore;

createRoot(document.getElementById("root")!).render(<App />);
