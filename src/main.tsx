import "./styles/index.css";
import { ViteReactSSG } from "vite-react-ssg/single-page";
import App from "./App";

// Build-time prerender + client hydrate (single route). Ships fully rendered
// HTML so search engines and non-JS AI crawlers get the real content.
export const createRoot = ViteReactSSG(<App />);
