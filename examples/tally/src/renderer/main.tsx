import { createRoot } from "react-dom/client";
import { Counter } from "../features/counter/client/index.ts";

createRoot(document.getElementById("root")!).render(<Counter />);
