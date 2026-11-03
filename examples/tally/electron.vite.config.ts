import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// Marram ships TypeScript sources, so it's bundled rather than left for Node to load.
const bundled = ["@raresportan/marram"];

export default defineConfig({
	main: { plugins: [externalizeDepsPlugin({ exclude: bundled })] },
	preload: {
		plugins: [externalizeDepsPlugin({ exclude: bundled })],
		// Sandboxed preloads must be CommonJS.
		build: { rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } } },
	},
	renderer: { plugins: [react()] },
});
